var fs = require("fs"),
    http = require("https"),
    url = require("url"),
    path = require("path"),
    qs = require('querystring'),
    child_process = require('child_process'),
    mediaPath = '/mnt/media/',
    defaultExt = '.mp4',
    maxBlockSize = 1024 * 1024 * 2,
    certPath = './daemon.cert',
    keyPath = './daemon.pkey';

var blacklist = [
  /^License/,
];

var options = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

function endsWith(str, ends) {
  return str.indexOf(ends) == (str.length - ends.length);
}

function delugePostMiddleware(req, res, cb) {
  if(!req.body) {
    cb();
    return;
  }
  var isMagnet = req.body.match(/magnet:\?xt=urn:[\:a-z0-9]{20,50}/i) != null;
  res.writeHead(isMagnet ? 200 : 500);
  if(isMagnet) {
      var proc = child_process.spawn('deluge-console', ['add', req.body]);
      var response = '';
      proc.stdout.on('data', function(resData) {
          response += resData;
      });
      proc.on('close', function(status) {
        res.write(response);
        cb();
      });
  } else {
      cb();
  }
}

function extractBody(req, res, cb) {
  var body = '',
      cancel = false;
  req.on('data', function(data) {
    body += data;
    if(body.length > 2048) {
      cancel = true;
      req.end();
      res.end();
    }
  });
  req.on('end', function() {
    if(cancel) {
      cb('cancelled');
      return;
    }
    if(body) {
      console.log('BODY', body);
      req.body = body;
    }
    cb();
  });
}

function ignoreIco(req, res, cb) {
  if(endsWith(req.url, '.ico')) {
      res.writeHead(200);
      res.end();
  } else {
    cb();
  }
}

function renderFileListing(req, res) {
  var files = req.mediaFiles,
      mediaDir = req.mediaDir;
  for(var c = 0; c < files.length; ++c) {
    var href = path.join(mediaDir, files[c]).replace(mediaPath, ''),
        isBlacklisted = blacklist.some(function(b) { return href.match(b) != null; }); 
    
    if(isBlacklisted) {
        continue;
    }
    try {
        var subStat = fs.statSync(path.join(mediaDir, files[c]));
        if(subStat.isFile() && endsWith(href, defaultExt)) {
            res.write('<video src="' + href + '" controls></video>');
        } else if (subStat.isDirectory()) {
            res.write('<a href="' + href + '">' + href + '</a><br />');
        }
    } catch(ex) {
        console.log('Exception', ex);
    }
  }
}

function streamMediaFile(req, res, cb) {
  var file = req.mediaDir;
  console.log('streaming', file);
  var range = req.headers.range;
  var positions = range.replace(/bytes=/, "").split("-");
  var start = parseInt(positions[0], 10);
  console.log('reading', range, file);
  fs.stat(file, function(err, stats) {
    if (err) {
       cb(err.message);
       return;
    }
    var total = stats.size;
    var max = start + maxBlockSize;
    var end = positions[1] ? parseInt(positions[1], 10) : total - 1;
    if(end > max) {
      end = max;
    }
    var chunksize = (end - start) + 1;

    res.writeHead(206, {
      "Content-Range": "bytes " + start + "-" + end + "/" + total,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "video/mp4"
    });

    var stream = fs.createReadStream(file, { start: start, end: end })
    stream.on("open", function() {
      stream.pipe(res);
    });
    stream.on('end', cb);
    stream.on("error", cb);
  });
}

function mediaListing(req, res, cb) {
    var relPath = path.join('.', qs.unescape(req.url).replace('..', ''));
    req.mediaDir = path.join(mediaPath, relPath);
    console.log('listing', req.mediaDir, relPath);
    if (!endsWith(req.mediaDir, defaultExt)) {
      fs.stat(req.mediaDir, function(err, stats) {
          if(err) {
              cb(err.message);
              return;
          }
          if(stats.isDirectory()) {
            fs.readdir(req.mediaDir, function(err, files) {
              if(err) {
                  cb(err.message);
                  return;
              }
              req.mediaFiles = files;
              res.writeHead(200, { "Content-Type": "text/html" });
              renderFileListing(req, res);
              cb();
            });
          }
      });
    } else {
      streamMediaFile(req, res, cb);
  }
}

function wrapRequest(req, res) {
  var middleware = [ignoreIco, extractBody, delugePostMiddleware, mediaListing];
  function middlewareCallback(idx, err) {
    if(err) {
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end(err);
      return;
    }
    if(idx >= middleware.length) {
      res.end();
      return;
    }
    console.log('calling middleware', idx);
    middleware[idx](req, res, middlewareCallback.bind(null, idx+1));
  }
  middlewareCallback(0);
}

http.createServer(options, wrapRequest).listen(8888);
