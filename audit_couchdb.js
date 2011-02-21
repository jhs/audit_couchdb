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
    var ddoc_url = lib.join(db_url, ddoc._id);

    if(ddoc.language !== info.view_index.language)
      throw new Error("Different languages in ddoc vs. index info: " + JSON.stringify(info) + " vs. language = " + JSON.stringify(ddoc.language));

    if(ddoc.language !== 'javascript')
      this.medium("Non-standard language '" + ddoc.language + '": ' + ddoc_url);

    // Detect unsafe rewrites.
    (ddoc.rewrites || []).forEach(function(rule) {
      var parts = rule.to.split(/\//);

      var depth = 0
        , minimum_depth = 0;
      parts.forEach(function(part) {
        depth += (part === '..' ? -1 : 1);
        if(depth < minimum_depth)
          minimum_depth = depth;
      })

      if(minimum_depth === -2)
        self.low("Database-level rewrite " + JSON.stringify(rule) + ": " + ddoc_url);
      else if(minimum_depth === -3)
        self.medium("Root-level rewrite " + JSON.stringify(rule) + ": " + ddoc_url);
      else if(minimum_depth < -3)
        self.high("Unknown rewrite " + JSON.stringify(rule) + ": " + ddoc_url);
    })
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
