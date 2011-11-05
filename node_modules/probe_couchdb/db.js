// Probe all details about a CouchDB database.
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
  { 'do_ddocs': true
  }, function(module, exports, DEFS, require) {


var lib = require('./lib')
  , util = require('util')
  , assert = require('assert')
  , Emitter = require('./emitter').Emitter
  , querystring = require('querystring')
  , DesignDocument = require('./ddoc').DesignDocument
  ;


module.exports = { "Database": Database
                 };


util.inherits(Database, Emitter);
function Database () {
  var self = this;
  Emitter.call(self);

  self.couch = null;
  self.name = null;
  self.url = null;
  self.do_ddocs = DEFS.do_ddocs;

  self.on('start', function probe_metadata() {
    self.log.debug("Fetching db metadata: " + self.url);
    self.request({uri:self.url}, function(er, resp, info) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode === 401 && typeof info === 'object' && info.error === 'unauthorized')
        // Indicate no read permission.
        self.x_emit('metadata', null);
      else if(resp.statusCode === 200 && typeof info === 'object')
        self.x_emit('metadata', info);
      else
        return self.x_emit('error', new Error("Unknown db responses: " + JSON.stringify(info)));
    })
  })

  self.on('start', function probe_security_object() {
    var sec_url = lib.join(self.url, '/_security');
    self.log.debug("Fetching db security data: " + sec_url);
    self.request({uri:sec_url}, function(er, resp, security) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode === 401 && typeof security === 'object' && security.error === 'unauthorized')
        // Indicate no read permission.
        self.x_emit('security', null);
      else if(resp.statusCode === 200 && typeof security === 'object')
        self.x_emit('security', security);
      else
        return self.x_emit('error', new Error("Unknown db responses: " + JSON.stringify(security)));
    })
  })

  self.on('start', function probe_ddocs() {
    if(!self.do_ddocs) {
      self.log.debug('Skipping ddoc probe');
      return self.x_emit('end_ddocs');
    }

    self.log.debug("Scanning for design documents: " + self.name);
    self.all_docs({startkey:'_design/', endkey:'_design0'}, function(er, view) {
      if(er)
        return self.x_emit('error', er);

      var ids = view && view.rows.map(function(row) { return row.id });
      if(!ids)
        self.log.debug(self.name+' has unknown design documents: no read permission');
      else
        self.log.debug(self.name+' has '+ids.length+' design documents: ' + ids.join(', '));

      self.x_emit('ddoc_ids', ids);
    })
  })

  self.on('ddoc_ids', function emit_ddoc_probes(ids) {
    ids = ids || [];
    self.log.debug('Creating probes for ' + ids.length + ' ddocs');

    if(ids.length === 0) {
      // Simply mark the ddocs as done.
      self.x_emit('end_ddocs');
      return;
    }

    // Track pending ddocs to determine when all are done.
    var pending_ddocs = {};

    ids.forEach(function(id) {
      var ddoc = new DesignDocument;
      ddoc.db = self.url;
      ddoc.id = id;
      ddoc.log.setLevel(self.log.level.levelStr);

      pending_ddocs[ddoc.id] = ddoc;

      ddoc.on('end', mark_ddoc_done);
      ddoc.on('error', function(er) {
        mark_ddoc_done();
        self.x_emit('error', er)
      })

      function mark_ddoc_done() {
        delete pending_ddocs[ddoc.id];
        if(Object.keys(pending_ddocs).length === 0)
          self.x_emit('end_ddocs');
      }

      self.x_emit('ddoc', ddoc);
      ddoc.start();
    })
  })

  self.known('metadata', function(metadata) {
    self.known('security', function(security) {
      self.known('end_ddocs', function() {
        self.x_emit('end');
      })
    })
  })

} // Database


Database.prototype.all_docs = function(opts, callback) {
  var self = this;
  if(!callback && typeof opts == 'function') {
    callback = opts;
    opts = {};
  }

  opts = opts || {};
  assert.equal(typeof opts, 'object', 'all_docs needs an options object parameter');
  assert.equal(typeof callback, 'function', 'all_docs needs a callback function parameter');

  opts.include_docs = !! opts.include_docs;
  if(opts.startkey)
    opts.startkey = JSON.stringify(opts.startkey);
  if(opts.endkey)
    opts.endkey = JSON.stringify(opts.endkey);

  var qs = querystring.stringify(opts);
  var view = lib.join(self.url, '/_all_docs?' + qs);

  self.log.debug('Querying _all_docs: ' + self.name + ' ' + JSON.stringify(opts));
  self.request({uri:view}, function(er, resp, body) {
    if(er)
      return callback(er);
    else if(resp.statusCode === 401 && typeof body === 'object' && body.error === 'unauthorized')
      return callback(null, null); // Indicate no read permission.
    else if(resp.statusCode !== 200 || !('rows' in body))
      return callback(new Error("Bad _all_docs response: "+view+": "+JSON.stringify({code:resp.statusCode, body:body})));

    return callback(null, body);
  })
}


Database.prototype.start = function() {
  var self = this;

  if(!self.couch)
    throw new Error("Couch URL required");
  if(!self.name)
    throw new Error("Database name required");

  self.url = lib.join(self.couch, encodeURIComponent(self.name));
  self.x_emit('start');
}

}) // defaultable
