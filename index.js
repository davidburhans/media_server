var fs = require("fs"),
    http = require("http"),
    url = require("url"),
    path = require("path"),
    qs = require('querystring'),
    child_process = require('child_process'),
    mediaPath = '/mnt/media/',
    defaultExt = '.mp4',
    maxBlockSize = 1024 * 1024 * 2;

function endsWith(str, ends) {
    return str.indexOf(ends) == (str.length - ends.length);
}

http.createServer(function (req, res) {
  if(req.method == 'POST') {
    var d = '';
    req.on('data', function(data) {
      d += data;
    });
    req.on('end', function() {
      console.log('POST', d);
      var isMagnet = d.match(/magnet:\?xt=urn:[\:a-z0-9]{20,50}/i) != null;
      res.writeHead(isMagnet ? 200 : 500);
      if(isMagnet) {
          var proc = child_process.spawn('deluge-console', ['add', d]);
          var response = '';
          proc.stdout.on('data', function(resData) {
              response += resData;
          });
          proc.on('close', function(status) {
          	res.end(response);
          });
      } else {
          res.end();
      }
    });
    return;
  }
  var relPath = path.join('.', qs.unescape(req.url.replace('..', '')));
  if(endsWith(relPath, '.ico')) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    return;
  }
  console.log('relPath is', relPath, endsWith(relPath, defaultExt));
  if (!endsWith(relPath, defaultExt)) {
    var mediaDir = path.join(mediaPath, relPath);
    console.log('listing', mediaDir);
    fs.stat(mediaDir, function(err, stats) {
        if(err) {
            res.end(err.message);
            return;
        }
        if(stats.isDirectory()) {
            fs.readdir(mediaDir, function(err, files) {                
                if(err) {
                    res.end(err.message);
                    return;
                }     
                res.writeHead(200, { "Content-Type": "text/html" });
                for(var c = 0; c < files.length; ++c) {
                    var href = path.join(req.url, files[c]);
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
                res.end();
            });
        }
    });
  } else {
    var file = path.join(mediaPath, relPath);
    console.log('streaming', file);
    var range = req.headers.range;
    var positions = range.replace(/bytes=/, "").split("-");
    var start = parseInt(positions[0], 10);
    console.log('reading', range);
    fs.stat(file, function(err, stats) {
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
        .on("open", function() {
          stream.pipe(res);
        }).on("error", function(err) {
          res.end(err);
        });
    });
  }
}).listen(8888);
