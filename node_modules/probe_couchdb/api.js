// The probe_couchdb API
//

module.exports = { "CouchDB"       : require('./couch').CouchDB
                 , "Database"      : require('./db').Database
                 , "DesignDocument": require('./ddoc').DesignDocument
                 , "join"          : require('./lib').join
                 , "encode_id"     : require('./lib').encode_id
                 }
