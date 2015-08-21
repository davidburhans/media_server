var child_process = require('child_process');

function addFromBody(req, res, cb) {
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

exports.addFromBody = addFromBody
