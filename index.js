var fs = require("fs"),
    http = require("https"),
    url = require("url"),
    path = require("path"),
    qs = require('querystring'),
    deluge = require('./deluge'),
    options = require('./media_server.json'),
    compression = require('compression'),
    router = require('router')(),
    debug = require('debug')('media_server'),
    finalhandler = require('finalhandler');

var mediaPath = options.mediaPath,
    defaultExt = options.defaultExt,
    maxBlockSize = options.maxBlockSize,
    blacklist = options.blacklist;

options.server = options.server || {};
if(options.server.key) {
  options.server.key = fs.readFileSync(options.server.key);
}
if(options.server.cert) {
  options.server.cert = fs.readFileSync(options.server.cert);
}

function endsWith(str, ends) {
  return str.indexOf(ends) == (str.length - ends.length);
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
      debug('BODY', body);
      req.body = body;
    }
    cb();
  });
}

function ignoreIco(req, res, cb) {
  if(endsWith(req.url, '.ico')) {
      res.statusCode = 200;
      res.end();
  } else {
    cb();
  }
}

function renderFileListing(req, res) {
  var files = req.mediaFiles,
      mediaDir = req.mediaDir;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html');
  for(var c = 0; c < files.length; ++c) {
    var href = path.join(mediaDir, files[c]).replace(mediaPath, ''),
        isBlacklisted = blacklist.some(function(b) { return href.match(b) != null; });

    if(isBlacklisted) {
        continue;
    }
    try {
        var subStat = fs.statSync(path.join(mediaDir, files[c]));
        var isVideo = subStat.isFile() && endsWith(href, defaultExt);
        if (isVideo || subStat.isDirectory()) {
            res.write('<a href="' + href + '">' + href + '</a><br />');
        }
    } catch(ex) {
        debug('Exception', ex);
    }
  }
  res.end()
}

function streamMediaFile(req, res, cb) {
  var relPath = path.join('.', qs.unescape(req.url).replace('..', ''));
  req.mediaDir = path.join(mediaPath, relPath);
  var file = req.mediaDir;
  var range = req.headers.range;
  if(!range) {
    debug('rendering video element')
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html')
    res.end('<video src="' + req.url + '" controls></video>')
    return
  }
  debug('streaming', file);
  var positions = range.replace(/bytes=/, "").split("-");
  var start = parseInt(positions[0], 10);
  debug('reading', range, file);
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

    res.statusCode = 206;
    res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + total);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", chunksize);
    res.setHeader("Content-Type", "video/mp4");

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
    if (!endsWith(req.mediaDir, defaultExt)) {
      debug('listing', req.mediaDir, relPath);
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
              renderFileListing(req, res);
              cb();
            });
          }
      });
    }
}

// router.use(compression());
router.get(/.+ico/, ignoreIco);
router.use(extractBody);
router.post('/', deluge.addFromBody)
router.get(RegExp('\\' + defaultExt + '$'), streamMediaFile);
router.get(/.+/, mediaListing);


http.createServer(options.server, function(req, res) {
  router.handle(req, res, finalhandler(req, res));
}).listen(8888);
