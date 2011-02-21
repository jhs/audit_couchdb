// Probe all details about a CouchDB.
//

var lib = require('./lib')
  , LOG = lib.getLogger('audit_couchdb')
  , util = require('util')
  , events = require('events')
  , request = require('request')
  ;

function Couch(url) {
  var self = this;
  events.EventEmitter.call(self);

  self.log = lib.getLogger(url || 'audit_couchdb.Couch');
  self.url = url || null;
  self.proxy = null;
  self.only_dbs = null;
  self.pending = {};

  //

  self.on('couchdb', function(hello) {
    self.log.debug("Scanning databases: " + self.url);
    var all_dbs = lib.join(self.url, '/_all_dbs');
    self.request({uri:all_dbs}, function(er, resp, body) {
      if(er) throw er;
      if(resp.statusCode !== 200 || !Array.isArray(body))
        throw new Error("Bad _all_dbs from " + all_dbs + ": " + JSON.stringify(body));

      self.log.debug("Databases in " + self.url + ": " + JSON.stringify(body));
      var dbs_to_check = body.filter(function(db_name) {
        return (!self.only_dbs) || (self.only_dbs.indexOf(db_name) === -1);
      })
      self.log.debug("Databases to check in " + self.url + ": " + JSON.stringify(dbs_to_check));

      if(dbs_to_check.length === 0)
        self.emit('end');

      dbs_to_check.forEach(function(db_name) {
        self.emit('db_name', db_name);
      })
    })
  })

  self.on('db_name', function(db_name) {
    var db_url  = lib.join(self.url, encodeURIComponent(db_name))
      , sec_url = lib.join(db_url, '/_security')
      ;

    self.pending[db_url] = {};

    var data = {info:null, security:null};
    function got(key, val) {
      self.log.debug("Received " + key + " for " + db_url);
      data[key] = val;

      if(data.info && data.security) {
        self.log.debug("Received metadata and security about db: " + db_url);

        if(data.info.resp.statusCode     === 401 && data.info.body.error     === 'unauthorized'
        && data.security.resp.statusCode === 401 && data.security.body.error === 'unauthorized') {
          self.log.debug("No read permission: " + db_url);
          self.emit('database_unauthorized', db_url)
        } else if (data.info.resp.statusCode !== 200 || data.security.resp.statusCode !== 200
                   || typeof data.info.body !== 'object' || typeof data.security.body !== 'object') {
          throw new Error("Unknown db responses: " + JSON.stringify({db:db_info.data, security:security.data}));
        } else {
          self.emit('database_ok', db_url, data.info.body, data.security.body);
        }

        self.emit('database', db_url, data.info, data.security);
      }
    }

    self.log.debug("Fetching db metadata: " + db_url);
    self.request({uri:db_url}, function(er, resp, body) {
      if(er) throw er;
      //if(resp.statusCode !== 200 || typeof body !== 'object' || false)
      //  throw new Error("Bad db response from " + db_url + ": " + JSON.stringify(body));
      got('info', {resp:resp, body:body});
    })

    self.log.debug("Fetching db security data: " + sec_url);
    self.request({uri:sec_url}, function(er, resp, body) {
      if(er) throw er;
      //if(resp.statusCode !== 200 || typeof body !== 'object')
      //  throw new Error("Bad db response from " + db_url + ": " + JSON.stringify(body));
      got('security', {resp:resp, body:body});
    })
  })

  self.on('database_unauthorized', function(db_url) {
    self.finish_db(db_url);
  })

  self.on('database_ok', function(db_url, db_info, security) {
    self.log.debug("Successful db fetch: " + db_url);
    var view = [ '/_all_docs?include_docs=false'
               , 'startkey=' + encodeURIComponent(JSON.stringify("_design/"))
               , 'endkey='   + encodeURIComponent(JSON.stringify("_design0"))
               ].join("&");
    view = lib.join(db_url, view);

    self.log.debug("Scanning for design documents: " + db_url);
    self.request({uri:view}, function(er, resp, body) {
      if(er) throw er;
      if(resp.statusCode !== 200 || !("rows" in body))
        throw new Error("Bad ddoc response from " + view + ": " + JSON.stringify(body));

      self.log.debug("Design documents in " + db_url + ": " + body.rows.map(function(x) { return x.id }).join(', '));

      if(body.rows.length === 0)
        self.finish_db(db_url);

      body.rows.forEach(function(row) {
        self.emit('ddoc_id', db_url, row.id);
      })
    })
  })

  self.on('ddoc_id', function(db_url, doc_id) {
    var ddoc_url = lib.join(db_url, doc_id)
      , info_url = lib.join(ddoc_url, '/_info');

    self.pending[db_url][doc_id] = 1;

    var data = {ddoc: null, info: null};
    function got(type, value) {
      self.log.debug("Received " + type + " for " + ddoc_url);
      data[type] = value;

      if(data.ddoc && data.info) {
        self.log.debug("Received both contents and info about ddoc: " + ddoc_url);
        self.emit('ddoc', db_url, data.ddoc, data.info);
      }
    }

    self.log.debug("Fetching ddoc info: " + info_url);
    self.request({uri:info_url}, function(er, resp, body) {
      if(er) throw er;
      if(resp.statusCode !== 200 || typeof body !== 'object')
        throw new Error("Bad info response for " + info_url + ": " + JSON.stringify(body));
      got('info', body);
    })

    self.log.debug("Fetching ddoc contents: " + ddoc_url);
    self.request({uri:ddoc_url}, function(er, resp, body) {
      if(er) throw er;
      if(resp.statusCode !== 200 || typeof body !== 'object')
        throw new Error("Bad ddoc response for " + ddoc_url + ": " + JSON.stringify(body));
      got('ddoc', body);
    })
  })

  self.on('ddoc', function(db_url, ddoc, info) {
    self.finish_ddoc(db_url, ddoc._id);
  })

} // Couch
util.inherits(Couch, events.EventEmitter);

Couch.prototype.finish_ddoc = function(db_url, id) {
  var self = this;

  delete self.pending[db_url][id];
  if(Object.keys(self.pending[db_url]).length === 0) {
    self.log.debug("All design docs complete: " + db_url);
    self.finish_db(db_url);
  }
}

Couch.prototype.finish_db = function(db_url) {
  var self = this;

  delete self.pending[db_url];
  if(Object.keys(self.pending).length === 0) {
    self.log.debug("All databases complete");
    self.emit('end');
  }
}

Couch.prototype.request = function request_wrapper(opts, callback) {
  var self = this;

  function json_body(er, resp, body) {
    if(!er)
      body = JSON.parse(body);
    return callback && callback.apply(this, [er, resp, body]);
  }

  opts.proxy  = opts.proxy  || self.proxy;
  opts.client = opts.client || self.client;
  opts.followRedirect = false;

  opts.headers = opts.headers || {};
  opts.headers.accept = opts.headers.accept || 'application/json';
  //opts.headers.Connection = opts.headers.Connection || 'keep-alive';

  if(opts.method && opts.method !== "GET" && opts.method !== "HEAD")
    opts.headers['content-type'] = 'application/json';

  return request.apply(this, [opts, json_body]);
}

Couch.prototype.start = function() {
  var self = this;

  if(!self.url)
    throw new Error("url required");

  self.log.debug("Pinging: " + self.url);
  self.request({uri:self.url}, function(er, resp, body) {
    if(er) throw er;
    if(resp.statusCode !== 200 || body.couchdb !== "Welcome")
      throw new Error("Bad welcome from " + self.url + ": " + JSON.stringify(body));

    self.client = resp.client;
    self.client = null; // Reusing the client isn't working right now.

    self.log.debug("Good welcome received: " + self.url);
    self.emit('couchdb', body);
  })
}

// TODO emit vulnerability

module.exports = { "Couch": Couch
                 };
