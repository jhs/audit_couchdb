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

  self.on('ddoc', function(db_url, ddoc, info) {
    if(ddoc.language !== info.view_index.language)
      throw new Error("Different languages in ddoc vs. index info: " + JSON.stringify(info) + " vs. language = " + JSON.stringify(ddoc.language));

    if(ddoc.language !== 'javascript')
      this.medium("Non-standard language '" + ddoc.language + '": ' + lib.join(db_url, ddoc._id));
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
