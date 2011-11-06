#!/usr/bin/env node
// The audit_couchdb command-line interface.
//

var fs = require('fs')
  , lib = require('./lib')
  , assert = require('assert')
  , optimist = require('optimist')
  , Audit = require('./audit_couchdb').CouchAudit
  ;

function usage() {
  console.log([ 'usage: audit_couchdb <URL>'
              , ''
              ].join("\n"));
}

var argv = optimist.default({log: 'info'})
                   .argv;

var couch_url = argv._[0];
if(!couch_url || argv.help) {
  usage();
  process.exit(couch_url ? 0 : 1);
}

if(!/^https?:\/\//.test(couch_url))
  couch_url = 'http://' + couch_url;

var couch = new Audit;
couch.url = couch_url;
couch.log.setLevel(argv.log);
couch.only_dbs = (argv.db ? [argv.db] : null);

var count = 0;
couch.on('vulnerability', function(problem) {
  count += 1;
  var msg = [count, problem.level, problem.fact].join("\t");
  if(problem.hint)
    msg += " | " + problem.hint;

  if(problem.level === 'low')
    couch.log.info(msg);
  else if(problem.level === 'medium')
    couch.log.warn(msg);
  else if(problem.level === 'high')
    couch.log.error(msg);
  else
    throw new Error("Unknown problem level: " + JSON.stringify(problem));
})

couch.on('end', function() {
  couch.log.info("Scan complete");
})

couch.start();
