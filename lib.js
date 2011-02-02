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

module.exports = { "getLogger"  : getLogger
                 , "join"       : join_and_fix_slashes
                 };
