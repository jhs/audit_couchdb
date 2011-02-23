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

  self.known = {};

  var wait_for = { session: []
                 , config : []
                 , users  : []
                 };

  Object.keys(wait_for).forEach(function(key) {
    self.known[key] = function on_known_value(cb, new_value) {
      var current_val = wait_for[key];
      if(new_value) {
        current_val.forEach(function(cb) {
          cb && cb(new_value);
        })
        wait_for[key] = new_value;
      } else {
        // Normal fetch.
        if(Array.isArray(current_val))
          current_val.push(cb)
        else
          return cb && cb(current_val); // The callback list has been replace with the session itself.
      }
    }
  })

  self.on('couchdb', function(welcome) {
    self.low("People know you are using CouchDB v" + welcome.version);
  })

  self.on('config', function(config) {
    if(config) {
      // One thing to check is how many admins there are.
      var admin_names = Object.keys(config.admins || {});
      if(admin_names.length < 1)
        self.V({ level: 'high'
               , fact : 'This couch is in Admin Party'
               , hint : 'Log in to Futon (/_utils) and click "Fix this"'
               });
      else if(admin_names.length > 1)
        self.V({ level: 'medium'
               , fact : admin_names.length + " system admin accounts: " + JSON.stringify(admin_names)
               , hint : 'In production, admins should be used rarely or never, but yet you have many'
               });
    }

    // Mark the config known for waiting functions.
    self.known.config(null, config);
  })

  self.on('session', function(session) {
    session = new lib.Session(session);
    var roles = '; site-wide roles: ' + JSON.stringify(session.userCtx.roles);

    if(session.anonymous()) {
      if(session.admin())
        self.medium("Auditing as: admin party" + roles);
      else
        self.medium('Auditing as: anonymous' + roles);
    } else {
      if(session.admin())
        self.medium("Auditing as: authenticated admin" + roles);
      else
        self.medium("Auditing as: authenticated user" + roles);
    }

    if(session.info.authentication_db !== '_users')
      this.medium('Non-standard authentication DB: ' + session.info.authentication_db);

    var ok_handlers = ['oauth', 'cookie', 'default'];
    session.info.authentication_handlers.forEach(function(handler) {
      if(ok_handlers.indexOf(handler) === -1)
        this.medium('Non-standard authentication handler: ' + handler);
    })

    // Finally, remember the session and run any pending callbacks expecting it.
    self.known.session(null, session);
  })

  var user_docs = [];
  self.on('user', function(user_doc) {
    if(user_doc) {
      // Simply remember this for later.
      user_docs.push(user_doc);
    } else {
      // The entire list of users is known. Compute each of their login sessions.
      self.known.config(function(config) {
        var user_pool = {};
        user_docs.forEach(function(doc) {
          var session = lib.Session.normal(doc.name, doc.roles, config);
          user_pool[doc.name] = {doc:doc, session:session};
        })

        // Mark the list of users known for pending callbacks.
        self.known.users(null, user_pool);
      })
    }
  })

  self.on('database_ok', function(url, info, security) {
    self.log.debug("Tracking ddocs in database: " + url);
    var db = {info:info, security:security, ddocs: []};
    self.known[url] = db;

    if(!('readers' in security))
      self.V({ level: 'low'
             , fact : 'No security.readers: ' + url
             , hint : 'Your enemies know you can\'t be arsed to click the "Security" link'
             });

    self.known.users(function(users) {
      var counts = lib.db_access_counts(users, db);
      self.medium(counts.sys_admin + " server admins, " + counts.admin + " db admins: " + url);
      self.low(counts.reader + ' readers, ' + counts.none + ' no-access: ' + url);
    })
  })

  self.on('database_unauthorized', function(url) {
    self.known[url] = null;
    this.low("Database is unauthorized: " + url);
  })

  self.on('database_done', function(url) {
    var db = self.known[url];
    if(db === null) // DB was unauthorized.
      return;

    var validator_count = db.ddocs.reduce(function(sum, ddoc) { return sum + (ddoc.validate_doc_update ? 1 : 0) }, 0);
    if(0 < validator_count && validator_count < db.ddocs.length)
      self.low(db.ddocs.length + " design documents has only " + validator_count + " validators: " + url);

    if(validator_count < 1) {
      var msg = 'No validation functions ('+db.ddocs.length+' design documents): ' + url;

      self.known.users(function(users) {
        var anon_user = users[null];
        if(anon_user.session.admin_party()) {
          self.V({ level:'medium'
                 , fact :msg
                 , hint : "I would worry about Admin Party first, if I were you"
                 });
        } else if(anon_user.session.access_to(db.security).length > 0) {
          self.V({ level:'high'
                 , fact :msg
                 , hint : "Your enemies can change and delete your "+db.info.doc_count+" docs."
                        + " Are you fucking crazy?"
                 });
        } else {
          // Okay, it's not Admin Party or wide open. But how bad is it?
          var counts = lib.db_access_counts(users, db);
          var hint = 'Users with access'
                   + ': server admin=' + counts.sys_admin
                   + '; db admin=' + counts.admin
                   + '; reader=' + counts.reader
                   + '; no access=' + counts.none;

          if(counts.reader === 0)
            self.V({ level:'low'
                   , fact : msg
                   , hint : hint + '; looks like only admins use this database'
                   });
          else
            self.V({ level: 'high'
                   , fact : msg
                   , hint : hint + '; those ' + counts.reader + ' readers could destroy this db'
                   });
        }
      })

      self.known.session(function(session) {
        /*
        if(session.admin_party())
        else if(session.anonymous())
        else if(session.normal()) {
          self.V({ level:'medium'
                 , fact :msg
                 , hint : "Your enemies can change and delete your "+db.info.doc_count+" docs."
                        + " Are you fucking crazy?"
                 });
          if(session.access_to(db.security, 'admin'))
            msg += " (Why bother giving "+session.name()+" admin access? You have bigger fish to fry.)";
          else
            msg += " ("+session.name()+" could wreak havoc)";
        }

        self.high(msg);
        */
      })
    }
  })

  self.on('ddoc', function(db_url, ddoc, info) {
    var ddoc_url = lib.join(db_url, ddoc._id);
    self.known[db_url].ddocs.push(ddoc);

    if(typeof ddoc.language === 'undefined') {
      self.low('No language defined (assuming "javascript"): ' + ddoc_url);
      ddoc.language = 'javascript';
    }

    if(ddoc.language !== info.view_index.language)
      throw new Error("Different languages in ddoc vs. index info: " + JSON.stringify(info) + " vs. language = " + JSON.stringify(ddoc.language));

    if(ddoc.language !== 'javascript')
      this.medium('Non-standard language "' + ddoc.language + '": ' + ddoc_url);

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
  CouchAudit.prototype[level] = function(fact, hint) {
    this.V({level:level, fact:fact, hint:hint});
  }
})

CouchAudit.prototype.V = function emit_vulnerability(vuln) {
  this.emit('vulnerability', vuln);
}

module.exports = { "CouchAudit": CouchAudit
                 };
