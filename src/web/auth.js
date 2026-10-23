'use strict';

const DISCORD_API = 'https://discord.com/api/v10';

// Strip any trailing slash(es) so WEB_URL="https://x/" doesn't produce a
// "https://x//auth/callback" that fails to match the registered redirect.
function redirectUri() {
  const base = (process.env.WEB_URL || '').replace(/\/+$/, '');
  return `${base}/auth/callback`;
}

function getOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  redirectUri(),
    response_type: 'code',
    scope:         'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri(),
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal:  AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token exchange failed: ${res.status} — ${txt.slice(0, 100)}`);
  }
  return res.json();
}

async function getUserInfo(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal:  AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`User info failed: ${res.status}`);
  return res.json();
}

module.exports = { getOAuthUrl, exchangeCode, getUserInfo };
