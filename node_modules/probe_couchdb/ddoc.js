// Probe all details about a CouchDB design document
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
  {}
  , function(module, exports, DEFS, require) {


var lib = require('./lib')
  , util = require('util')
  , Emitter = require('./emitter').Emitter
  ;


module.exports = { "DesignDocument": DesignDocument
                 };


util.inherits(DesignDocument, Emitter);
function DesignDocument () {
  var self = this;
  Emitter.call(self);

  self.db = null;
  self.id = null;
  self.url = null;

  self.on('start', function probe_doc() {
    self.log.debug("Fetching design document: " + self.url);
    self.request({uri:self.url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);
      else if(resp.statusCode !== 200 || typeof body !== 'object')
        return self.x_emit('error', new Error("Bad ddoc response from " + self.url + ": " + JSON.stringify({code:resp.statusCode, body:body})));

      self.x_emit('body', body);
    })
  })

  self.on('start', function probe_info() {
    var info_url = lib.join(self.url, '/_info');
    self.log.debug("Fetching ddoc info: " + info_url);
    self.request({uri:info_url}, function(er, resp, body) {
      if(er)
        return self.x_emit('error', er);

      // CouchDB 1.1.0 and 1.1.1 returns a 500 if the view definitions are malformed: COUCHDB-1318
      if(resp.statusCode == 500 && body && body.error == 'unknown_error' && body.reason == 'function_clause') {
        self.log.debug('Server error, probably malformed design document: ' + self.url);
        return self.x_emit('info', null);
      }

      if(resp.statusCode !== 200 || typeof body !== 'object')
        return self.x_emit('error', new Error("Bad ddoc response from " + info_url + ": " + JSON.stringify({code:resp.statusCode, body:body})));

      self.x_emit('info', body);
    })
  })

  self.known('body', function(body) {
    self.x_emit('language', body.language);

    var views = body.views || {};
    Object.keys(views).forEach(function(view_name) {
      self.x_emit('view', view_name, views[view_name]);
    })

    self.x_emit('end_views');
  })

  self.on('view', function(view_name, view) {
    self.known('language', function(language) {
      if(typeof language == 'undefined')
        language = 'javascript';

      if(language != 'javascript')
        return self.log.debug('Skipping checks for unknown view language: ' + language);

      if(!view || lib.isArray(view) || typeof view != 'object')
        return self.x_emit('code_error', new Error('Not a view object'), view_name, null, view);

      if(view.map)
        try       { lib.check_expr(view.map, 'map')                          }
        catch (e) { self.x_emit('code_error', e, view_name, 'map', view.map) }

      if(view.reduce && view.reduce[0] != '_')
        try       { lib.check_expr(view.reduce, 'reduce')                          }
        catch (e) { self.x_emit('code_error', e, view_name, 'reduce', view.reduce) }
    })
  })

  self.known('body', function(body) {
    self.known('info', function(info) {
      self.known('end_views', function(views) {
        self.x_emit('end');
      })
    })
  })

} // DesignDocument

DesignDocument.prototype.start = function() {
  var self = this;

  if(!self.db)
    throw new Error("Couch database URL required");
  if(!self.id)
    throw new Error("Document ID required");

  // Since this is a design document, the slash must be kept.
  self.url = lib.join(self.db, lib.encode_id(self.id));
  self.x_emit('start');
}

}) // defaultable
