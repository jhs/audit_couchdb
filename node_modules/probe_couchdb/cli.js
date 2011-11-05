#!/usr/bin/env node
// The probe_couchdb command-line interface.
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

var fs = require('fs')
  , assert = require('assert')
  , probe_couchdb = require('./api')
  ;

function usage() {
  console.log([ 'usage: probe_couchdb <URL>'
              , ''
              ].join("\n"));
}

var couch_url = process.argv[2];
if(!couch_url) {
  usage();
  process.exit(1);
}

if(!/^https?:\/\//.test(couch_url))
  couch_url = 'http://' + couch_url;

var defs = { 'log_level': process.env.log || 'info'
           , 'do_users' : process.env.do_users != 'false'
           , 'do_dbs'   : process.env.do_dbs != 'false'
           , 'max_users': +(process.env.max_users || 1000)
           , 'label'    : process.env.label || 'probe'
           };

probe_couchdb = probe_couchdb.defaults(defs);
var couch = new probe_couchdb.CouchDB();
couch.url = couch_url;

var count = 0;
function line() {
  count += 1;
  var parts = [count].concat(Array.prototype.slice.apply(arguments));
  console.log(parts.join("\t"));
}

function errline() {
  count += 1;
  var parts = [count].concat(Array.prototype.slice.apply(arguments));
  console.error(parts.join("\t"));
}

function handler_for(ev_name) {
  return function event_handler(obj) {
    line(ev_name, JSON.stringify(obj));
  }
}

var NORMAL_EVENTS = { couch: ['couchdb', 'dbs', 'session', 'config']
                    , db   : ['metadata', 'security', 'ddoc_ids', 'end']
                    , ddoc : ['info', 'end']
                    };

NORMAL_EVENTS.couch.forEach(function(ev_name) {
  couch.on(ev_name, handler_for(ev_name));
})

couch.on('error', function(er) {
  console.error(er.message || er)
})

couch.on('end', function() {
  line('end', 'Probe complete');
})

couch.on('users', function show_users(users) {
  line('users', '(' + Object.keys(users).length + ' users, including the anonymous user)');
})

couch.on('pingquery', function(language, result) {
  var write = result.ok ? line : errline;
  write('QS ping', language, JSON.stringify(result));
})

couch.on('db', function(db) {
  NORMAL_EVENTS.db.forEach(function(ev_name) {
    db.on(ev_name, handler_for([ev_name, db.name].join(' ')));
  })

  db.on('ddoc', function(ddoc) {
    var path = [db.name, ddoc.id].join('/');

    NORMAL_EVENTS.ddoc.forEach(function(ev_name) {
      ddoc.on(ev_name, handler_for([ev_name, path].join(' ')));
    })

    ddoc.on('body', function show_ddoc_body(body) {
      line(['body', path].join(' '), '(' + JSON.stringify(body).length + ' characters; ' + Object.keys(body).length + ' top-level keys)');
    })

    ddoc.on('code_error', function(er, name, type, code) {
      var extra = '';
      if(('line' in er) && ('col' in er))
        extra = ' at line '+er.line+', column ' + er.col;

      errline( 'bad code' + extra
             , ['', db.name, ddoc.id, '_view', name].join('/')
             , er.message || er.stack || er
             , type + ': ', JSON.stringify(code)
             )
    })
  })
})

line("Number", "Event", "Data");
couch.start();
