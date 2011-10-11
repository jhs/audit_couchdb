// Probe all details about a CouchDB design document
//

var lib = require('./lib')
  , util = require('util')
  , assert = require('assert')
  , Emitter = require('./emitter').Emitter
  ;

function DesignDocument () {
  var self = this;
  Emitter.call(self);

  self.db = null;
  self.id = null;
  self.url = null;

  self.on('start', function probe_doc() {
    self.log.debug("Fetching design document: " + self.url);
    self.request({uri:self.url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode !== 200 || typeof body !== 'object')
        return self.x_emit('error', new Error("Bad ddoc response from " + self.url + ": " + JSON.stringify({code:resp.statusCode, body:body})));

      self.x_emit('body', body);
    })
  })

  self.on('start', function probe_info() {
    var info_url = lib.join(self.url, '/_info');
    self.log.debug("Fetching ddoc info: " + info_url);
    self.request({uri:info_url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode !== 200 || typeof body !== 'object')
        return self.x_emit('error', new Error("Bad ddoc response from " + info_url + ": " + JSON.stringify({code:resp.statusCode, body:body})));

      self.x_emit('info', body);
    })
  })

  self.known('body', function(body) {
    self.known('info', function(info) {
      self.x_emit('end');
    })
  })

} // DesignDocument
util.inherits(DesignDocument, Emitter);

DesignDocument.prototype.start = function() {
  var self = this;

  if(!self.db)
    throw new Error("Couch database URL required");
  if(!self.id)
    throw new Error("Document ID required");

  // Since this is a design document, the slash must be kept.
  self.url = lib.join(self.db, lib.encode_id(self.id));
  self.x_emit('start');
}

module.exports = { "DesignDocument": DesignDocument
                 };
