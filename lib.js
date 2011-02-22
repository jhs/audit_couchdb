// Miscellaneous helpers
//

// log4js is optional.
function getLogger(label) {
  var log;
  try {
    log = require('log4js')().getLogger(scrub_creds(label || 'audit_couchdb'));
    log.setLevel('info');
  } catch(e) {
    log = { "trace": function() {}
          , "debug": function() {}
          , "info" : console.log
          , "warn" : console.log
          , "error": console.log
          , "fatal": console.log
          }
    log.setLevel = function noop() {};
  }

  // Scrub credentials.
  ; ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(function(level) {
    var inner = log[level];
    log[level] = function log_scrubbed() {
      var args = Array.prototype.slice.apply(arguments);
      args[0] = scrub_creds(args[0]);
      return inner.apply(this, args);
    }
  })

  return log;
}

function scrub_creds(url) {
  if(typeof url === 'string')
    url = url.replace(/(https?:\/\/)[^:]+:[^@]+@(.*)$/, '$1$2'); // Scrub username and password
  return url;
}

function join_and_fix_slashes() {
  return Array.prototype.map.apply(arguments, [function trimmed(arg) {
    return arg.replace(/^\/+/, "").replace(/\/+$/, "");
  }]).join('/');
}

function normalize_security(security) {
  security = JSON.parse(JSON.stringify(security));
  security.admins = security.admins || {};
  security.admins.names = security.admins.names || [];
  security.admins.roles = security.admins.roles || [];
  security.readers = security.readers || {};
  security.readers.names = security.readers.names || [];
  security.readers.roles = security.readers.roles || [];
  return security;
}

function admin_session(name) {
  return { userCtx: { name:(name || null), roles:['_admin'] } }
}

function admin_party_session() {
  return admin_session(null);
}

function normal_session(name, roles) {
  return { userCtx: { name:(name || null), roles:(roles || []) } }
}

function anonymous_session() {
  return normal_session(null, []);
}

session = { anonymous: anonymous_session
          , admin_party: admin_party_session
          , admin      : admin_session
          , normal     : normal_session
          };

module.exports = { "getLogger"  : getLogger
                 , "join"       : join_and_fix_slashes
                 , "normalize_security" : normalize_security
                 , "session"    : session
                 };
