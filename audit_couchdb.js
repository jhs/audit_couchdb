// The audit_couchdb API
//

var lib = require('./lib')
  , util = require('util')
  , events = require('events')
  , probe_couchdb = require('./probe_couchdb')
  ;

function CouchAudit(url) {
  var self = this;
  probe_couchdb.Couch.call(self);

  self.on('couchdb', function(welcome) {
    self.low("People know you are using CouchDB v" + welcome.version);
  })

  self.on('database_ok', function(url, info, security) {
    if("readers" in security) {
      // TODO
    } else {
      this.high("No security.readers: " + url);
    }
  })

  self.on('database_unauthorized', function(url) {
    this.low("Database is unauthorized: " + url);
  })

  self.on('end', function() {
    console.log("DONE!");
  })
}
util.inherits(CouchAudit, probe_couchdb.Couch);

; ['low', 'medium', 'high'].forEach(function(level) {
  CouchAudit.prototype[level] = function(message) {
    this.emit('vulnerability', {level:level, message:message});
  }
})

module.exports = { "CouchAudit": CouchAudit
                 };
