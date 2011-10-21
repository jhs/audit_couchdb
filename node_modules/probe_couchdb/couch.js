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
  }, function(module, exports, DEFS, require) {


var lib = require('./lib')
  , util = require('util')
  , Emitter = require('./emitter').Emitter
  , Database = require('./db').Database
  ;

module.exports = { "CouchDB": CouchDB
                 };

function CouchDB () {
  var self = this;
  Emitter.call(self);

  self.url = null;
  self.only_dbs = null;
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
      if( ((session.userCtx || {}).roles || []).indexOf('_admin') === -1 )
        self.log.warn("Results will be incomplete without _admin access");
      self.x_emit('session', session);
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

  self.on('config', function(config) {
    // Once the config is known, the list of users can be established.
    var auth_db = config && config.couch_httpd_auth && config.couch_httpd_auth.authentication_db;
    if(!auth_db) {
      auth_db = '_users';
      self.log.warn('authentication_db not found in config; trying ' + JSON.stringify(auth_db));
    }

    // Of course, the anonymous user is always known to exist.
    var anonymous_users = [ self.anonymous_user() ];

    var auth_db_url = lib.join(self.url, encodeURIComponent(auth_db).replace(/^_design%2[fF]/, '_design/'));
    self.log.debug("Checking auth_db: " + auth_db_url);
    self.request({uri:auth_db_url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      if(resp.statusCode !== 200 || typeof config !== 'object') {
        self.log.warn("Can not access authentication_db: " + auth_db_url);
        // Signal the end of the users discovery.
        self.x_emit('users', anonymous_users);
      } else if(body.doc_count > self.max_users) {
        return self.x_emit('error', new Error("Too many users; you must add a view to process them"));
        // TODO
      } else {
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

          var users = body.rows
                      .filter(function(row) { return /^org\.couchdb\.user:/.test(row.id) })
                      .map(function(row) { return row.doc });
          self.log.debug("Found " + (users.length+1) + " users (including anonymous): " + auth_db_url);
          self.x_emit('users', anonymous_users.concat(users));
        })
      }
    })
  })

  self.known('couchdb', function(welcome) {
    self.known('users', function(users) {
      self.known('session', function(session) {
        self.known('config', function(config) {
          self.known('end_dbs', function() {
            self.x_emit('end');
          })
        })
      })
    })
  })

} // CouchDB

util.inherits(CouchDB, Emitter);

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
