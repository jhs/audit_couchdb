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

  var session = []; // Initialize to a list of callbacks waiting for the value.
  self.known.session = function on_known_session(cb, new_session) {
    if(new_session) {
      // Setting a new session.
      session.forEach(function(cb) {
        cb && cb(new_session);
      })
      session = new_session;
    } else {
      // Normal session fetch.
      if(Array.isArray(session))
        session.push(cb);
      else
        return cb && cb(session); // The callback list has been replace with the session itself.
    }
  }

  self.on('couchdb', function(welcome) {
    self.low("People know you are using CouchDB v" + welcome.version);
  })

  self.on('session', function(session) {
    var helpers =
      { name       : function get_name() { return session.userCtx.name }
      , name_h     : function get_name_human() { return helpers.name() || '(Anonymous)' }
      , anonymous  : function is_anonymous() { return helpers.name() === null }
      , role       : function has_role(r) { return session.userCtx.roles.indexOf(r) !== -1 }
      , admin      : function is_admin() { return helpers.role('_admin') }
      , admin_party: function is_admin_party() { return helpers.admin() && helpers.anonymous() }
      , normal     : function is_normal() { return ! helpers.anonymous() }
      }

    // Return an array of reasons why this session would be granted access to a given database's _security object.
    helpers.access_to = function enumerate_permissions(security, perm_test) {
      security = JSON.parse(JSON.stringify(security));
      security.admins = security.admins || {};
      security.admins.names = security.admins.names || [];
      security.admins.roles = security.admins.roles || [];
      security.readers = security.readers || {};
      security.readers.names = security.readers.names || [];
      security.readers.roles = security.readers.roles || [];

      var rights = [];
      var right_tests = {sys_admin: false, admin:false, reader:false};

      if(helpers.admin()) {
        right_tests.sys_admin = true;
        rights.push({reason:'server admin', right:'delete db'});
        rights.push({reason:'server admin', right:'change ddocs'});
      }

      security.admins.names.forEach(function(name) {
        if(name === helpers.name()) {
          right_tests.admin = true;
          var reason = 'admin name: ' + JSON.stringify(name);
          rights.push({reason:reason, right:'read and change all docs and ddocs'});
        }
      })

      security.admins.roles.forEach(function(role) {
        if(helpers.role(role)) {
          right_tests.admin = true;
          var reason = 'admin role: ' + JSON.stringify(role);
          rights.push({reason:reason, right:'read and change all docs and ddocs'});
        }
      })

      security.readers.names.forEach(function(name) {
        if(name === helpers.name()) {
          right_tests.reader = true;
          var reason = 'reader name: ' + JSON.stringify(name);
          rights.push({reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
        }
      })

      security.readers.roles.forEach(function(role) {
        if(helpers.role(role)) {
          right_tests.reader = true;
          var reason = 'reader role: ' + JSON.stringify(name);
          rights.push({reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
        }
      })

      if(security.readers.names.length + security.readers.roles.length === 0) {
        right_tests.reader = true;
        var reason = 'public db';
        rights.push({reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
      }

      if(perm_test)
        return right_tests[perm_test];
      return rights;
    }

    Object.keys(helpers).forEach(function(helper_name) {
      if(helper_name in session)
        throw new Error("Woa, there. The session is crowding my helper name '"+helper_name+"': " + JSON.stringify(session));
      session[helper_name] = helpers[helper_name];
    })

    if(session.anonymous()) {
      if(session.admin())
        self.high("Access: admin party");
      else
        self.low('Access: anonymous');
    } else {
      if(session.admin())
        self.medium("Access: authenticated admin");
      else
        self.low("Access: authenticated user");

      self.low("Site-wide roles: " + JSON.stringify(session.userCtx.roles));
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

  self.on('database_ok', function(url, info, security) {
    self.log.debug("Tracking ddocs in database: " + url);
    self.known[url] = {info:info, security:security, ddocs:[]};

    self.known.session(function(session) {
      if("readers" in security) {
        var passes = session.access_to(security);

        if(passes.length < 1)
          throw new Error("Can not figure out how you can read "+url+"; security="+JSON.stringify(security)+" ; session="+JSON.stringify(session));

        if(passes.length > 1)
          self.medium([session.name_h(), 'has', passes.length, 'ways to access', url].join(' '));

        passes.forEach(function(perm) {
          var msg = [session.name_h(), 'can', perm.right, url, 'because:', perm.reason].join(' ');
          self.low(msg);
        })
      } else {
        var msg = 'No security.readers: ' + url;

        var extra;
        if(session.admin_party())
          extra = "But what do you care? You're already in Admin Party.";
        if(session.anonymous())
          extra = 'Your enemies know you can\'t be arsed even to click the "Security" link and hit "Update"';

        self.high(msg + (extra ? " ("+extra+")" : ""));
      }
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
      var msg = 'No validation functions ('+db.ddocs.length+' design document' + (db.ddocs.length===1 ? 's' : '') + '): ' + url;
      self.known.session(function(session) {
        if(session.admin_party())
          msg += " (But what do you care? You're already in Admin Party.)";
        else if(session.anonymous())
          msg += " (Your enemies are changing and deleting your "+db.info.doc_count+" docs. Are you fucking crazy?)";
        else if(session.normal()) {
          if(session.access_to(db.security, 'admin'))
            msg += " (Why bother giving "+session.name()+" admin access? You have bigger fish to fry.)";
          else
            msg += " ("+session.name()+" could wreak havoc)";
        }

        self.high(msg);
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
  CouchAudit.prototype[level] = function(message) {
    this.emit('vulnerability', {level:level, message:message});
  }
})

module.exports = { "CouchAudit": CouchAudit
                 };
