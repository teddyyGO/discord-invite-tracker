'use strict';

// Best-effort resolve Discord user IDs → display names for the web UI.
async function resolveNames(client, ids) {
  const names = {};
  const unique = [...new Set(ids.filter(Boolean))];
  await Promise.all(unique.map(async id => {
    try {
      const cached = client.users.cache.get(id);
      const user = cached ?? await client.users.fetch(id);
      names[id] = user.username;
    } catch {
      names[id] = null;
    }
  }));
  return names;
}

async function resolveChannelNames(client, ids) {
  const names = {};
  await Promise.all(ids.filter(Boolean).map(async id => {
    try {
      const ch = client.channels.cache.get(id) ?? await client.channels.fetch(id);
      names[id] = ch?.name ?? null;
    } catch { names[id] = null; }
  }));
  return names;
}

module.exports = { resolveNames, resolveChannelNames };
