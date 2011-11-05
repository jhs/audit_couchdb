// Miscellaneous helpers
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

var log4js = require('log4js')
  , assert = require('assert')
  , uglify = require('uglify-js')
  , defaultable = require('defaultable')
  ;

defaultable(module,
  { 'log_label': 'probe_couchdb'
  , 'log_level': 'info'
  }, function(module, exports, DEFS, require) {


module.exports = { "getLogger"  : getLogger
                 , "get_creds"  : get_creds
                 , "isArray"    : isArray
                 , "join"       : join_and_fix_slashes
                 , "encode_id"  : encode_doc_id
                 , "isRegExp"   : isRegExp
                 , "check_expr" : check_expr
                 };


function getLogger(label) {
  var log = log4js.getLogger(scrub_creds(label || DEFS.log_label));
  log.setLevel(DEFS.log_level);

  // Scrub credentials.
  ; ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(function(level) {
    var inner = log[level];
    log[level] = log_scrubbed;

    function log_scrubbed() {
      var args = Array.prototype.slice.apply(arguments);
      args[0] = scrub_creds(args[0]);
      return inner.apply(this, args);
    }
  })

  return log;
}

var url_parts = /(https?:\/\/)([^:]+:[^@]+@)?(.*)$/;

function get_creds(url) {
  var match = url_parts.exec(url);
  if(!match)
    throw new Error("Cannot parse URL: " + url);
  var auth = match[2];
  match = /^(.*?):(.*)@$/.exec(auth);
  if(!match)
    return [null, null];
  return [match[1], match[2]];
}

function scrub_creds(url) {
  if(typeof url === 'string')
    url = url.replace(url_parts, '$1$3'); // Scrub username and password
  return url;
}

function join_and_fix_slashes() {
  return Array.prototype.map.apply(arguments, [function trimmed(arg) {
    return arg.replace(/^\/+/, "").replace(/\/+$/, "");
  }]).join('/');
}

// Encode a document ID, which means escape it *except* the slash in a design document.
function encode_doc_id(id) {
  var encoded = encodeURIComponent(id);
  return encoded.replace(/^_design%2[fF]/, '_design/');
}

function isRegExp(obj) {
  var str = '' + obj;
  return !! ( obj instanceof RegExp ||
              typeof obj === 'function' &&
              obj.constructor.name === 'RegExp' &&
              obj.compile &&
              obj.test &&
              obj.exec &&
              str.match(/^\/.*\/[gim]{0,3}$/)
            )
}

function check_expr(source_code, type) {
  var ast = uglify.parser.parse('(' + source_code + ')');
  assert.equal(ast[0], 'toplevel');

  var statements = ast[1];
  assert.equal(statements.length, 1);

  var func_expr = statements[0];
  assert.equal(func_expr.length, 2);
  assert.equal(func_expr[0], 'stat');

  var func_def = func_expr[1];
  assert.equal(func_def[0], 'function');
  // assert.equal(func_def[1], 'map');

  var formals = func_def[2];
  function assert_formals() {
    var expected = Array.prototype.slice.apply(arguments);
    if(JSON.stringify(formals) !== JSON.stringify(expected))
      throw new Error('Nonstandard '+type+' function; expected function('+expected.join(', ')+'), got function('+formals.join(', ')+')');
  }

  if(type == 'map')
    assert_formals('doc');

  if(type == 'reduce')
    assert_formals('keys', 'values', 'rereduce');
}

function isArray(obj) {
  return Array.isArray(obj);
}

}) // defaultable
