// Audit the CouchDB replicator
//

module.exports = ReplicatorAudit


var util = require('util')
var async = require('async')
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
  self.log.debug('Check replicator db: %s', db_name)

  var db_url = probe_couchdb.join(self.url, db_name, '/_changes?include_docs=true')
  self.request(db_url, function(er, res, changes) {
    if(er)
      return self.x_emit('error', er)

    changes = (changes.results || [])
                .map(function(change) { return change.doc || {} })
                .filter(is_replication_doc)

    async.forEach(changes, audit, audited)

    function audit(doc, to_async) {
      process.nextTick(function() {
        self.audit_replication(doc, to_async)
      })
    }

    function audited(er) {
      if(er)
        return self.x_emit('error', er)

      self.x_emit('audit_done')
    }
  })
}

ReplicatorAudit.prototype.audit_replication = function(doc, callback) {
  var self = this
  self.log.debug('Audit replication: %j', doc)

  var state = doc._replication_state
  if(!state)
    return callback(new Error('Unknown replication doc: ' + JSON.stringify(doc)))

  process.nextTick(callback)
}


function is_replication_doc(doc) {
  return doc && (typeof doc._id == 'string') && !doc._id.match(/^_design\//)
}
