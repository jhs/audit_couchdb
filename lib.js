// Miscellaneous helpers
//

function normalize_security(security) {
  security = JSON.parse(JSON.stringify(security));
  security.admins = security.admins || {};
  security.admins.names = security.admins.names || [];
  security.admins.roles = security.admins.roles || [];
  security.readers = security.readers || {};
  security.readers.names = security.readers.names || [];
  security.readers.roles = security.readers.roles || [];
  return security;
}

function Session(session) {
  session = JSON.parse(JSON.stringify(session));
  var helpers =
    { name       : function get_name() { return session.userCtx.name }
    , name_h     : function get_name_human() { return helpers.name() || '(Anonymous)' }
    , anonymous  : function is_anonymous() { return helpers.name() === null }
    , role       : function has_role(r) { return session.userCtx.roles.indexOf(r) !== -1 }
    , admin      : function is_admin() { return helpers.role('_admin') }
    , admin_party: function is_admin_party() { return helpers.admin() && helpers.anonymous() }
    , normal     : function is_normal() { return ! helpers.anonymous() }
    }

  // Return an array of reasons why this session would be granted access to a given database's _security object.
  helpers.access_to = function enumerate_permissions(security, perm_test) {
    security = normalize_security(security);
    var rights = [];

    if(helpers.admin()) {
      if(perm_test === 'sys_admin')
        return true;

      rights.push({type:'sys_admin', reason:'server admin', right:'delete db'});
      rights.push({type:'sys_admin', reason:'server admin', right:'change ddocs'});
    }

    security.admins.names.forEach(function(name) {
      if(name === helpers.name()) {
        if(perm_test === 'admin')
          return true;
        var reason = 'admin name: ' + JSON.stringify(name);
        rights.push({type:'admin', reason:reason, right:'read and change all docs and ddocs'});
      }
    })

    security.admins.roles.forEach(function(role) {
      if(helpers.role(role)) {
        if(perm_test === 'admin')
          return true;
        var reason = 'admin role: ' + JSON.stringify(role);
        rights.push({type:'admin', reason:reason, right:'read and change all docs and ddocs'});
      }
    })

    security.readers.names.forEach(function(name) {
      if(name === helpers.name()) {
        if(perm_test === 'reader')
          return true;
        var reason = 'reader name: ' + JSON.stringify(name);
        rights.push({type:'reader', reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
      }
    })

    security.readers.roles.forEach(function(role) {
      if(helpers.role(role)) {
        if(perm_test === 'reader')
          return true;
        var reason = 'reader role: ' + JSON.stringify(role);
        rights.push({type:'reader', reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
      }
    })

    if(security.readers.names.length + security.readers.roles.length === 0) {
      if(perm_test === 'reader')
        return true;
      var reason = 'public db';
      rights.push({type:'reader', reason:reason, right:'read all docs, change non-ddocs per validate_doc_update'});
    }

    if(perm_test)
      return false;
    return rights;
  }

  Object.keys(helpers).forEach(function(helper_name) {
    if(helper_name in session)
      throw new Error("Woa, there. The session is crowding my helper name '"+helper_name+"': " + JSON.stringify(session));
    session[helper_name] = helpers[helper_name];
  })

  return session;
}

Session.admin = function admin_session(name) {
  return new Session({ userCtx: { name:(name || null), roles:['_admin'] } })
}

Session.admin_party = function admin_party_session() {
  return Session.admin(null);
}

Session.normal = function normal_session(name, roles, config) {
  roles = roles || [];
  if(config && config.admins && name && (name in config.admins))
    roles = ['_admin'].concat(roles);
  return new Session({ userCtx: { name:(name || null), roles:roles } })
}

Session.anonymous = function anonymous_session() {
  return Session.normal(null, []);
}

function db_access_counts(sessions, security) {
  var counts = {sys_admin:0, admin:0, reader:0, none:0};
  sessions.forEach(function(session) {
    var permissions = session.access_to(security);
    if(permissions.some(function(perm) { return perm.type === 'sys_admin' }))
      counts.sys_admin += 1;
    else if(permissions.some(function(perm) { return perm.type === 'admin' }))
      counts.admin += 1;
    else if(permissions.some(function(perm) { return perm.type === 'reader' }))
      counts.reader += 1;
    else
      counts.none += 1;
  })
  return counts;
}

module.exports = { "normalize_security" : normalize_security
                 , "Session"    : Session
                 , "db_access_counts" : db_access_counts
                 };
