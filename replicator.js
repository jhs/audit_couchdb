// Audit the CouchDB replicator
//

module.exports = ReplicatorAudit


var util = require('util')
var events = require('events')
var probe_couchdb = require('probe_couchdb').defaults(
  { 'log_label': 'audit_couchdb_replication'
  , 'do_users' : false
  , 'do_ddocs' : false
  , 'do_dbs'   : false
  })

var lib = require('./lib')


util.inherits(ReplicatorAudit, probe_couchdb.CouchDB)
function ReplicatorAudit () {
  var self = this
  probe_couchdb.CouchDB.call(self)

  self.on('couchdb', function(welcome) {
    self.welcome(welcome)
  })
} // ReplicatorAudit

ReplicatorAudit.prototype.welcome = function(welcome) {
  var self = this

  var match = /^(\d+)\.(\d+)\.(\d+)$/.exec(welcome.version)
  if(!match)
    return self.x_emit('error', new Error('Unknown CouchDB version: ' + JSON.stringify(welcome)))

  var major    = +match[1]
  var minor    = +match[2]
  var revision = +match[3]

  if(major < 1 || (major == 1 && minor < 2))
    return self.x_emit('error', new Error('Replication audit supports only CouchDB 1.2.0 or later'))

  self.known('session', function(session) {
    session = new lib.Session(session)
    if(! session.admin())
      return self.x_emit('error', new Error('Replicator audit requires admin access'))

    self.known('config', function(config) {
      if(!config)
        return self.x_emit('error', new Error('Cannot fetch config'))

      var replicator = config.replicator || {}
      var rep_db = replicator.db
      if(!rep_db)
        return self.x_emit('error', new Error('Bad replicator config: ' + JSON.stringify(config.replicator)))

      self.audit_replicator(rep_db)
    })
  })
}

ReplicatorAudit.prototype.audit_replicator = function(db_name) {
  var self = this

  self.log.error('I should audit: %s', db_name)
}
