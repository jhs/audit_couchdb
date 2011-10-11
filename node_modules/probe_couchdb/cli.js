#!/usr/bin/env node
// The probe_couchdb command-line interface.
//

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

var couch = new probe_couchdb.CouchDB();
couch.url = couch_url;
couch.log.setLevel('debug');

var count = 0;
function line() {
  count += 1;
  var parts = [count].concat(Array.prototype.slice.apply(arguments));
  console.log(parts.join("\t"));
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

couch.on('end', function() {
  line('end', 'Probe complete');
})

couch.on('users', function show_users(users) {
  line('users', '(' + users.length + ' users, including the anonymous user)');
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
  })
})

line("Number", "Event", "Data");
couch.start();
