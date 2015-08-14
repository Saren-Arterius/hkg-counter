var restify = require('restify');
var singleton = require('run-singleton');
var parse = require('url').parse;
var redis = require("redis");
var Canvas = require('canvas');

var IMAGE_CACHE_TIME = 1;

var server = restify.createServer();
server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

var rClient = redis.createClient();

String.prototype.endsWith = function(suffix) {
  return this.indexOf(suffix, this.length - suffix.length) !== -1;
};

var getIP = function(req, res, next) {
  req.ip = req.headers["x-real-ip"] || req.connection.remoteAddress;
  next();
}

var checkReferer = function(req, res, next) {
  if (!("referer" in req.headers)) {
    res.send(400, "Request has no referer");
    return;
  }
  var referer = parse(req.headers.referer, true);
  if (!referer.host || !referer.host.endsWith("hkgolden.com") || referer.pathname !== "/view.aspx") {
    res.send(400, "Invalid referer URL");
    return;
  }
  req.messageID = parseInt(referer.query.message);
  if (isNaN(req.messageID)) {
    res.send(400, "Invalid message ID");
    return;
  }
  req.ipListKey = "topic_ip_list_" + req.messageID;
  req.viewedCountKey = "topic_viewed_count_" + req.messageID;
  next();
}

var generateImage = function(req, viewCount, callback) {
  var canvas = new Canvas(108, 28)
  var ctx = canvas.getContext('2d');
  ctx.font = '30px Impact';
  ctx.fillText(viewCount.toString(), 4, 24);
  canvas.toBuffer(function(err, buf) {
    req.result = buf;
    callback();
  });
}

var writeImage = function(req, res, imageData) {
  res.writeHead(200, {
    'Content-Length': imageData.length,
    'Content-Type': 'image/png'
  });
  res.write(imageData);
  res.end();
}

server.get('/', getIP, checkReferer, function(req, res, next) {
  rClient.sadd(req.ipListKey, req.ip, function(err1) {
    if (err1) {
      res.send(500, err1);
      return;
    }
    rClient.scard(req.ipListKey, function(err2, viewCount) {
      if (err2) {
        res.send(500, err2);
        return;
      }
      rClient.get(req.viewedCountKey, function(err3, imageData) {
        if (imageData) {
          writeImage(req, res, new Buffer(imageData, 'base64'));
          return;
        }
        req.singleton = {
          "key": req.viewedCountKey,
          "fn": function(callback) {
            generateImage(req, viewCount, function() {
              rClient.set(req.viewedCountKey, req.result.toString('base64'), function() {
                rClient.expire(req.viewedCountKey, IMAGE_CACHE_TIME);
              });
              callback();
            });
          },
          "respond": function(req, res) {
            writeImage(req, res, req.result);
          }
        };
        next();
      });
    });
  });
}, singleton);

server.listen(process.env.PORT || 2048, function() {
  console.log('%s listening at %s', server.name, server.url);
});
