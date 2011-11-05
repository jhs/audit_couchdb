// Probe all details about a CouchDB.
//
// Copyright 2011 Iris Couch
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

require('defaultable')(module,
  { 'max_users': 1000
  , 'url'      : null
  , 'do_dbs'   : true
  , 'do_users' : true
  , 'do_pingquery': true
  , 'only_dbs' : null
  }, function(module, exports, DEFS, require) {


var lib = require('./lib')
  , util = require('util')
  , Emitter = require('./emitter').Emitter
  , Database = require('./db').Database
  ;


module.exports = { "CouchDB": CouchDB
                 };


util.inherits(CouchDB, Emitter);
function CouchDB (url) {
  var self = this;
  Emitter.call(self);

  self.url = url || DEFS.url || null;
  self.do_dbs   = DEFS.do_dbs;
  self.only_dbs = DEFS.only_dbs || null;
  self.max_users = DEFS.max_users;

  self.on('start', function ping_root() {
    self.log.debug("Pinging: " + self.url);
    self.request({uri:self.url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode !== 200 || body.couchdb !== "Welcome")
        return self.x_emit('error', new Error("Bad welcome from " + self.url + ": " + JSON.stringify(body)));
      else
        self.x_emit('couchdb', body);
    })
  })

  self.on('couchdb', function probe_databases(hello) {
    if(!self.do_dbs) {
      self.log.debug('Skipping db probe');
      return self.x_emit('end_dbs');
    }

    var all_dbs = lib.join(self.url, '/_all_dbs');
    self.log.debug("Scanning databases: " + all_dbs);
    self.request({uri:all_dbs}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      if(resp.statusCode !== 200 || !Array.isArray(body))
        return self.x_emit('error', new Error("Bad _all_dbs from " + all_dbs + ": " + JSON.stringify(body)));

      self.log.debug(self.url + ' has ' + body.length + ' databases');

      var db_names = body;
      if(Array.isArray(self.only_dbs))
        db_names = db_names.filter(function(name) { return ~ self.only_dbs.indexOf(name) });
      else if(lib.isRegExp(self.only_dbs))
        db_names = db_names.filter(function(name) { return self.only_dbs.test(name) });

      self.x_emit('dbs', db_names);
    })
  })

  self.on('dbs', function emit_db_probes(dbs) {
    self.log.debug('Creating probes for ' + dbs.length + ' dbs');

    if(dbs.length === 0) {
      // Simply mark the dbs as done.
      self.x_emit('end_dbs');
      return;
    }

    // Track pending dbs to determine when all are done.
    var pending_dbs = {};

    // Avoid the warning for "too many" event listeners.
    process.on('unused', function() {}); // This avoids an undefined reference exception.
    process.setMaxListeners(dbs.length + 10);

    dbs.forEach(function(db_name) {
      var db = new Database;
      db.couch = self.url;
      db.name = db_name;
      db.log.setLevel(self.log.level.levelStr);

      pending_dbs[db.name] = db;

      db.on('end', mark_db_done);
      db.on('error', function(er) {
        mark_db_done();
        self.x_emit('error', er)
      })

      function mark_db_done() {
        delete pending_dbs[db.name];
        if(Object.keys(pending_dbs).length === 0)
          self.x_emit('end_dbs');
      }

      process.on('exit', function() {
        var names = Object.keys(pending_dbs);
        if(names.length > 0) {
          util.puts("Still have pending dbs: " + util.inspect(names));
        }
      })

      self.x_emit('db', db);
      db.start();
    })
  })

  self.on('couchdb', function probe_session(hello) {
    var session_url = lib.join(self.url, '/_session');
    self.log.debug("Checking login session: " + session_url);
    self.request({uri:session_url}, function(er, resp, session) {
      if(er)
        return self.x_emit('error', er);
      if(resp.statusCode !== 200 || (!session) || session.ok !== true)
        return self.x_emit('error', new Error("Bad _session from " + session_url + ": " + JSON.stringify(session)));
      self.log.debug("Received session: " + JSON.stringify(session));

      // Normalize the user_ctx for the user's convenience.
      var normal_session           = JSON.parse(JSON.stringify(session));
      normal_session.userCtx       = normal_session.userCtx || {};
      normal_session.userCtx.name  = normal_session.userCtx.name || null;
      normal_session.userCtx.roles = normal_session.userCtx.roles || [];

      if(!~ normal_session.userCtx.roles.indexOf('_admin'))
        self.log.debug("Results will be incomplete without _admin access");

      self.x_emit('session', normal_session, session);
    })
  })

  self.on('couchdb', function(hello) {
    var config_url = lib.join(self.url, '/_config');
    self.log.debug("Checking config: " + config_url);
    self.request({uri:config_url}, function(er, resp, config) {
      if(er)
        return self.x_emit('error', er);
      if(resp.statusCode !== 200 || (typeof config !== 'object')) {
        self.log.debug("Bad config response: " + JSON.stringify(config));
        config = null;
      }
      self.x_emit('config', config);
    })
  })

  // Probe the user accounts.
  self.on('config', function(config) {
    var all_users = {};

    // Of course, the anonymous user is always known to exist.
    all_users[null] = self.anonymous_user();

    if(!DEFS.do_users) {
      self.log.debug('Skipping user probe: disabled by config');
      return self.x_emit('users', all_users);
    }

    // Once the config is known, the list of users can be established.
    var auth_db = config && config.couch_httpd_auth && config.couch_httpd_auth.authentication_db;
    if(!auth_db) {
      auth_db = '_users';
      self.log.debug('authentication_db not found in config; trying ' + JSON.stringify(auth_db));
    }

    var auth_db_url = lib.join(self.url, encodeURIComponent(auth_db).replace(/^_design%2[fF]/, '_design/'));
    self.log.debug("Checking auth_db: " + auth_db_url);
    self.request({uri:auth_db_url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      if(resp.statusCode !== 200 || typeof config !== 'object') {
        self.log.debug("Can not access authentication_db: " + auth_db_url);
        self.x_emit('users', all_users);
      } else if(body.doc_count > self.max_users) {
        // TODO
        return self.x_emit('error', new Error('User count maximum ('+self.max_users+') is insufficent for this server: '+body.doc_count+' users'));
      }

      // Looks good. Get all the users.
      var users_query = lib.join(auth_db_url, '/_all_docs'
                                            + '?include_docs=true'
                                            + '&startkey=' + encodeURIComponent(JSON.stringify("org.couchdb.user:"))

                                            // CouchDB 1.1.0 has a bug preventing a "raw" scan from ':' to ';', so just
                                            // assume that the only documents are well-formed and filter on the client side.
                                            //+ '&endkey='   + encodeURIComponent(JSON.stringify("org.couchdb.user;"))
                                            );

      self.log.debug("Fetching all users: " + users_query);
      self.request({uri:users_query}, function(er, resp, body) {
        if(er)
          return self.x_emit('error', er);
        if(resp.statusCode !== 200 || !Array.isArray(body.rows))
          return self.x_emit('error', new Error("Failed to fetch user listing from " + users_query + ": " + JSON.stringify(body)));

        body.rows.forEach(function(row) {
          if(!! row.id.match(/^org\.couchdb\.user:/))
            all_users[row.id] = row.doc;
        })

        self.log.debug("Found " + Object.keys(all_users).length + " users (including anonymous): " + auth_db_url);
        self.x_emit('users', all_users);
      })
    })
  })

  self.known('session', function(session) {
    if(!DEFS.do_pingquery) {
      self.log.debug('Skipping QS ping: disabled by config');
      return self.x_emit('end_pings');
    }

    if(!~ session.userCtx.roles.indexOf('_admin')) {
      self.log.debug('Skipping QS ping: not an _admin session');
      return self.x_emit('end_pings');
    }

    self.known('config', function(config) {
      if(!config || !config.httpd_global_handlers || !config.query_servers) {
        self.log.debug('Skipping QS ping: bad config');
        return self.x_emit('end_pings');
      }

      var ping_path = null;
      Object.keys(config.httpd_global_handlers).forEach(function(path) {
        var has_plugin_re = /^\s*{\s*pingquery_couchdb\s*,\s*handle_pingquery_req\s*}\s*$/;
        if(config.httpd_global_handlers[path].match(has_plugin_re))
          ping_path = path;
      })

      if(!ping_path) {
        return self.log.debug('Skipping QS ping: no pingquery plugin');
        return self.x_emit('end_pings');
      }

      var languages = Object.keys(config.query_servers);
      var langs_todo = languages.length;
      function did(er, language) {
        langs_todo -= 1;
        if(langs_todo == 0)
          self.x_emit('end_pings');

        if(er)
          self.x_emit('error', er);
      }

      var supported = { javascript  : "function() { return (typeof log).replace(/^func/, 'ac') }"
                      , coffeescript: "() -> (typeof log).replace /^func/, 'ac'"
                      }

      languages.forEach(function(language) {
        var ping = { 'in':supported[language], 'out':"action" };

        if(!ping.in) {
          self.log.debug('Skipping ping unsupported QS language: ' + language);
          return did(null, language);
        }

        var req = { method:'POST'
                  , 'uri':lib.join(self.url, ping_path, language)
                  , 'body':JSON.stringify(ping)
                  }

        self.log.debug('Pinging QS language: '+language);
        self.request(req, function(er, resp, body) {
          if(!er)
            self.x_emit('pingquery', language, body);

          did(er, language);
        })
      })
    })
  })

  self.known('couchdb', function(welcome) {
    self.known('users', function(users) {
      self.known('session', function(session) {
        self.known('config', function(config) {
          self.known('end_dbs', function() {
            self.known('end_pings', function() {
              self.x_emit('end');
            })
          })
        })
      })
    })
  })

} // CouchDB


CouchDB.prototype.start = function() {
  var self = this;

  if(!self.url)
    throw new Error("url required");

  self.x_emit('start');
}


CouchDB.prototype.anonymous_user = function() {
  var self = this;
  return { name:null, roles: [] };
}


}) // defaultable
