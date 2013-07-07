#!/usr/bin/env node
//
// The audit_couchdb command-line interface.

var fs = require('fs')
var assert = require('assert')
var optimist = require('optimist')
var audit_couchdb = require('./audit_couchdb')


var OPTS = optimist.usage('$0 <URL>')
                   .describe('db=<db>', 'Only audit database <db>')
                   .describe('log', 'Log level')
                   .default('log', 'info')
                   .describe('replication', 'Audit replications')
                   .boolean('replication')

function main() {
  if(OPTS.argv.help)
    return console.log(OPTS.help())

  var couch_url = OPTS.argv._[0]
  if(!couch_url)
    return console.error(OPTS.help())

  if(! couch_url.match(/^https?:\/\//))
    couch_url = 'http://' + couch_url

  var couch = OPTS.argv.replication
                ? new audit_couchdb.Replicator
                : new audit_couchdb.CouchAudit

  couch.url = couch_url
  couch.log.setLevel(OPTS.argv.log)

  if(OPTS.argv.replication)
    replication(couch)
  else
    security(couch)

  couch.start()
}

function security(couch) {
  couch.only_dbs = (OPTS.argv.db ? [OPTS.argv.db] : null)

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
}

function replication(couch) {
  console.log('Audit replication')

  couch.on('end', function() {
    couch.log.info('Replicator audit complete')
  })
}

if(require.main === module)
  main()
