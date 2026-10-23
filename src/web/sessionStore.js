'use strict';

const { Store } = require('express-session');
const storage   = require('../core/storage');

class PgSessionStore extends Store {
  constructor() {
    super();
    setInterval(() => storage.cleanExpiredSessions().catch(() => {}), 60 * 60 * 1000);
  }

  get(sid, cb) {
    storage.getSession(sid).then(sess => cb(null, sess)).catch(cb);
  }

  set(sid, session, cb) {
    const maxAge = session.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge);
    storage.setSession(sid, session, expire).then(() => cb(null)).catch(cb);
  }

  destroy(sid, cb) {
    storage.destroySession(sid).then(() => cb(null)).catch(cb);
  }

  touch(sid, session, cb) {
    const maxAge = session.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
    const expire = new Date(Date.now() + maxAge);
    storage.touchSession(sid, expire).then(() => cb(null)).catch(cb);
  }
}

module.exports = PgSessionStore;
