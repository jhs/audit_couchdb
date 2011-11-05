// The audit_couchdb API
//

var lib = require('./lib')
  , util = require('util')
  , CVEs = require('./cves')
  , join = require('probe_couchdb').join
  , events = require('events')
  , probe_couchdb = require('probe_couchdb').defaults({'log_label':'audit_couchdb'})
  ;

util.inherits(CouchAudit, probe_couchdb.CouchDB);
function CouchAudit () {
  var self = this;
  probe_couchdb.CouchDB.call(self);

  self.on('couchdb', function(welcome) {
    self.low("People know you are using CouchDB v" + welcome.version);
    var match = /^(\d+)\.(\d+)\.(\d+)$/.exec(welcome.version);
    if(!match)
      self.medium('You have a weird CouchDB version: ' + JSON.stringify(welcome));
    else {
      var major    = parseInt(match[1])
        , minor    = parseInt(match[2])
        , revision = parseInt(match[3])
        ;

      CVEs.matching(major, minor, revision, function(cve) {
        self.V({ level: 'high'
               , fact : 'CVE Vulnerability: ' + cve.id
               , hint : cve.overview + ' See ' + cve.url
               , url: cve.url
               });
      })
    }
  })

  self.on('config', function(config) {
    if(!config)
      return self.V({ level: 'high'
                    , fact : 'Unknown config'
                    , hint : 'Re-run this probe as an admin'
                    })

    // One thing to check is how many admins there are.
    var futon = join(self.url, '/_utils/');
    var admins = config.admins || {};
    var admin_names = Object.keys(admins);
    if(admin_names.length < 1)
      self.V({ level: 'high'
             , fact : 'This couch is in Admin Party'
             , hint : 'Log in to Futon (/_utils) and click "Fix this"'
             , url: futon
             });
    else if(admin_names.length > 1)
      self.V({ level: 'medium'
             , fact : admin_names.length + " system admin accounts: " + JSON.stringify(admin_names)
             , hint : 'In production, admins should be used rarely or never, but yet you have many'
             , url: join(futon, '/config.html')
             });
  })

  self.on('session', function(normal_session, session) {
    session = new lib.Session(session);
    var roles = '; site-wide roles: ' + JSON.stringify(session.userCtx.roles);

    if(session.anonymous()) {
      if(session.admin())
        self.log.info("Auditing as: admin party" + roles);
      else
        self.log.warn('Auditing as: anonymous' + roles);
    } else {
      if(session.admin())
        self.log.info("Auditing as: authenticated admin" + roles);
      else
        self.log.warn("Auditing as: authenticated user" + roles);
    }
  })

  self.on('session', function(session) {
    var ok_handlers = ['oauth', 'cookie', 'default'];
    session.info.authentication_handlers.forEach(function(handler) {
      if(ok_handlers.indexOf(handler) === -1)
        this.medium('Non-standard authentication handler: ' + handler);
    })
  })

  self.on('session', function(session) {
    if(session.info.authentication_db !== '_users')
      this.low('Non-standard authentication DB: ' + session.info.authentication_db);
  })

  self.on('users', function(users) {
    self.known('config', function(config) {
      if(!config) return; // Can't do this part.

      var users_sessions = Object.keys(users).map(function(name) {
        var user = users[name];
        return lib.Session.normal(user.name, user.roles, config);
      });

      self.x_emit('sessions', users_sessions);
    })
  })

  self.on('db', function(db) {
    db.known('metadata', function(metadata) {
      db.known('security', function(security) {
        db.known('ddoc_ids', function(ddoc_ids) {
          if(metadata === null && security === null && ddoc_ids === null)
            return self.low("Database is unauthorized: " + db.name);
          else if(!metadata || !security || !ddoc_ids)
            throw new Error("Partial database results: " + JSON.stringify({metadata:metadata, security:security, ddoc_ids:ddoc_ids}));
          else
            self.x_emit('db_ok', {db:db, metadata:metadata, security:security, ddoc_ids:ddoc_ids});
        })
      })
    })
  })

  self.on('db_ok', function(data) {
    if(! ('readers' in data.security))
      self.V({ level: 'low'
             , fact : data.db.name + ': no security.readers'
             , hint : 'Your enemies know you can\'t be bothered to click the "Security" link'
             });
  })

  self.on('db', function(db) {
    db.on('security', function(security) {
      if(security)
        self.known('sessions', function(sessions) {
          var counts = lib.db_access_counts(sessions, security);
          db.x_emit('access_counts', counts);
        })
    })
  })

  self.on('db', function(db) {
    db.on('access_counts', function(counts) {
      self.medium(db.name + ': admin access: ' + counts.sys_admin + " server admins, " + counts.admin + " db admins");
      self.low(db.name + ': normal access: ' + counts.reader + " readers, " + counts.none + " no-access");
    })
  })

  self.on('db', function emit_validator_count(db) {
    var label = db.name + ': ';

    db.on('ddoc_ids', function(ddoc_ids) {
      if(!ddoc_ids)
        return self.log.warn(label + 'cannot check validate_doc_update counts');

      var validators = 0;
      db.on('ddoc', function(ddoc) {
        ddoc.on('body', function(doc) {
          var label = join(db.name, doc._id) + ': ';

          if('validate_doc_update' in doc)
            validators += 1;
          else
            self.V({ level: 'low'
                   , fact: label + 'no "validate_doc_update"'
                   , hint : 'This document alone cannot not protect a database from arbitrary modifications'
                   });
        })

        ddoc.on('code_error', function(er, name, type, code) {
          var label = join(db.name, ddoc.id, '_view', name);
          var vuln = { level: 'low'
                     , fact : label + ' ' + type + ' function: ' + (er.message || er.stack || er)
                     , hint : 'Standard, no-surprises source code is safest'
                     };

          if(('line' in er) && ('col' in er))
            vuln.hint = 'At line ' + er.line + ', column ' + er.col;

          self.V(vuln);
        })
      })

      db.on('end', function() {
        //util.puts('DB END: ' + db.name);
        db.x_emit('validators', validators);
      })
    })
  })

  self.on('db_ok', function check_validator_count(data) {
    var db = data.db, metadata = data.metadata, security = data.security;

    db.known('validators', function(validators) {
      if(validators > 0) {
        self.V({ level: 'low'
               , fact: db.name + ': confirmed with ' + validators + ' "validate_doc_update" functions'
               , hint: 'Good job.'
               })
      } else {
        self.known('config', function(config) {
          if(!config) {
            self.log.warn('Cannot determine permissions of "' + db.name + '" with no config; assuming no admin party');
            config = {admins: {}};
          }

          var anon_user = self.anonymous_user();
          var anon_session = lib.Session.normal(anon_user.name, anon_user.roles, config);
          var v = { fact: db.name + ': no "validate_doc_update" at all'
                  , level: 'high'
                  , hint: null
                  }

          if(anon_session.access_to(security).length > 0) {
            v.hint = "Anonymous enemies can change and delete your "+metadata.doc_count+" docs. Are you crazy?"
            self.V(v);
          } else {
            db.known('access_counts', function(counts) {
              v.hint = '"' + db.name + '" (with '+metadata.doc_count+' documents) is at the mercy of '
                     + counts.reader + ' users, '
                     + (counts.sys_admin + counts.admin) + ' admins'
              self.V(v);
            })
          }
        })
      }
    })
  })

  self.on('db', function(db) {
    db.on('ddoc', function(ddoc) {
      ddoc.on('body', function(doc) {
        var label = join(db.name, probe_couchdb.encode_id(doc._id)) + ': ';
        if(! ('language' in doc))
          self.low(label + 'no language defined; assuming "javascript"');
        var language = doc.language || 'javascript';

        if(language !== 'javascript')
          self.medium(label + 'non-standard language: ' + JSON.stringify(language));

        ddoc.known('info', function(info) {
          if(language !== info.view_index.language)
            throw new Error(label + "language differs from index info: " + JSON.stringify(language) + " vs. " + JSON.stringify(info));
        })
      })
    })

    db.on('ddoc', function detect_unsafe_rewrites(ddoc) {
      var rewrites = ddoc.rewrites || [];

      rewrites.forEach(function(rule) {
        var parts = rule.to.split(/\//);

        var depth = 0
          , minimum_depth = 0;
        parts.forEach(function(part) {
          depth += (part === '..' ? -1 : 1);
          if(depth < minimum_depth)
            minimum_depth = depth;
        })

        if(minimum_depth === -2)
          self.low(label + ": database-level rewrite " + JSON.stringify(rule));
        else if(minimum_depth === -3)
          self.medium(label + ": root-level rewrite " + JSON.stringify(rule));
        else if(minimum_depth < -3)
          self.high(label + ": unknown rewrite " + JSON.stringify(rule));
      })
    })
  })

} // CouchAudit

; ['low', 'medium', 'high'].forEach(function(level) {
  CouchAudit.prototype[level] = function(fact, hint) {
    this.V({level:level, fact:fact, hint:hint});
  }
})

CouchAudit.prototype.V = function emit_vulnerability(vuln) {
  this.emit('vulnerability', vuln);
}

module.exports = { "CouchAudit": CouchAudit
                 };
