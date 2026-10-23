'use strict';

function log(level, message, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level}] ${message}`;
  if (meta && Object.keys(meta).length) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

module.exports = {
  info:  (msg, meta = {}) => log('INFO',  msg, meta),
  warn:  (msg, meta = {}) => log('WARN',  msg, meta),
  error: (msg, meta = {}) => log('ERROR', msg, meta),
};
