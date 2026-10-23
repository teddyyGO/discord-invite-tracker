'use strict';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function permLabel(level) {
  if (level >= 2) return '<span style="color:var(--yellow);font-size:12px">⚙️ Admin</span>';
  if (level >= 1) return '<span style="color:var(--green);font-size:12px">🛡️ Moderator</span>';
  return '';
}

const CSS = `
:root{
  --bg:#1a1b1e;--bg-2:#212328;--surface:#25272d;--surface-2:#2c2f36;--border:#34373f;
  --border-2:#3d414b;--text:#e3e5e8;--muted:#9aa0aa;--faint:#6b7280;--accent:#5865f2;
  --accent-2:#7d88ff;--green:#57f287;--red:#ed4245;--yellow:#fee75c;--radius:12px;--shadow:0 1px 3px rgba(0,0,0,.4);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;line-height:1.5}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:#3a3d44;border-radius:6px;border:2px solid var(--bg)}
.sidebar{width:240px;background:linear-gradient(180deg,#202228,#1b1c20);padding:18px 14px;display:flex;flex-direction:column;min-height:100vh;position:fixed;left:0;top:0;bottom:0;border-right:1px solid var(--border)}
.sidebar-logo{font-size:17px;font-weight:800;color:#fff;padding:8px 8px 18px;margin-bottom:12px;border-bottom:1px solid var(--border)}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--muted);margin:2px 0;font-size:14px;font-weight:500;transition:.12s}
.nav-item:hover{background:var(--surface-2);color:var(--text)}
.nav-item.active{background:linear-gradient(135deg,var(--accent),#4752c4);color:#fff;box-shadow:0 2px 8px rgba(88,101,242,.35)}
.sidebar-user{margin-top:auto;padding-top:14px;border-top:1px solid var(--border)}
.sidebar-username{font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px}
.logout-btn{display:inline-block;margin-top:10px;padding:6px 14px;background:rgba(237,66,69,.12);color:var(--red);border-radius:6px;font-size:12px;font-weight:600;border:1px solid rgba(237,66,69,.3)}
.logout-btn:hover{background:rgba(237,66,69,.22)}
.main{margin-left:240px;padding:32px 36px;flex:1;min-width:0;max-width:1100px}
h1{font-size:24px;color:#fff;margin-bottom:24px;font-weight:700}
h2{font-size:16px;color:#fff;margin-bottom:16px;font-weight:700}
.card{background:var(--surface);border-radius:var(--radius);padding:22px;margin-bottom:20px;border:1px solid var(--border);box-shadow:var(--shadow)}
.card h2:first-child{margin-top:0}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px;margin-bottom:24px}
.stat-card{background:var(--surface);border-radius:var(--radius);padding:18px;border:1px solid var(--border);box-shadow:var(--shadow)}
.stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;font-weight:600}
.stat-value{font-size:30px;font-weight:800;color:#fff;line-height:1}
.stat-sub{font-size:11px;color:var(--faint);margin-top:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:11px 14px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);font-weight:700;background:var(--bg-2)}
td{padding:11px 14px;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--surface-2)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700}
.badge-green{background:rgba(87,242,135,.14);color:var(--green)}
.badge-red{background:rgba(237,66,69,.14);color:var(--red)}
.badge-yellow{background:rgba(254,231,92,.14);color:var(--yellow)}
.form-group{margin-bottom:18px}
label{display:block;font-size:12px;color:var(--muted);margin-bottom:7px;text-transform:uppercase;letter-spacing:.4px;font-weight:600}
input[type=text],input[type=number],select{width:100%;padding:11px 13px;background:var(--bg-2);border:1px solid var(--border-2);border-radius:8px;color:var(--text);font-size:14px;outline:none;font-family:inherit;transition:.12s}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(88,101,242,.18)}
.hint{font-size:11px;color:var(--faint);margin-top:6px}
.btn{padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;display:inline-block;transition:.12s}
.btn:hover{filter:brightness(1.1)}
.btn-primary{background:var(--accent);color:#fff}
.btn-ghost{background:var(--surface-2);color:var(--text);border:1px solid var(--border-2)}
.alert{padding:12px 16px;border-radius:8px;margin-bottom:18px;font-size:14px}
.alert-success{background:rgba(87,242,135,.1);color:var(--green);border:1px solid rgba(87,242,135,.3)}
.alert-danger{background:rgba(237,66,69,.1);color:var(--red);border:1px solid rgba(237,66,69,.3)}
.alert-warn{background:rgba(254,231,92,.08);color:var(--yellow);border:1px solid rgba(254,231,92,.28)}
code{background:var(--bg-2);padding:2px 6px;border-radius:5px;font-family:'Consolas',monospace;font-size:12px;color:var(--accent-2)}
.empty{text-align:center;color:var(--muted);padding:36px}
.input-row{display:flex;gap:10px;align-items:flex-end}.input-row .form-group{flex:1;margin-bottom:0}
.rank{font-weight:800;color:var(--muted)}
.uname{font-weight:600;color:#fff}
.reward-row{display:grid;grid-template-columns:1fr 1.6fr auto;gap:10px;margin-bottom:10px;align-items:center}
.reward-row .btn-remove{background:rgba(237,66,69,.12);color:var(--red);border:1px solid rgba(237,66,69,.3);padding:9px 13px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;line-height:1}
.toggle{position:relative;display:inline-block;width:50px;height:28px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;inset:0;background:var(--border-2);border-radius:28px;transition:.2s}
.slider:before{position:absolute;content:"";height:20px;width:20px;left:4px;bottom:4px;background:#d4d6da;border-radius:50%;transition:.2s}
input:checked + .slider{background:#248046}input:checked + .slider:before{transform:translateX(22px);background:#fff}
.switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--border)}
.max-w{max-width:760px}
`;

function layout(title, user, content, activePath = '') {
  const nav = [
    { path: '/dashboard',   label: '📊 Dashboard',   min: 1 },
    { path: '/leaderboard', label: '🏆 Leaderboard', min: 1 },
    { path: '/members',     label: '👥 Members',     min: 1 },
    { path: '/links',       label: '🔗 Links',       min: 1 },
    { path: '/logs',        label: '📋 Logs',        min: 1 },
    { path: '/config',      label: '⚙️ Config',      min: 2 },
  ].filter(i => user.permLevel >= i.min)
   .map(i => `<a href="${i.path}" class="nav-item${activePath === i.path ? ' active' : ''}">${i.label}</a>`)
   .join('');

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Invite Tracker</title><style>${CSS}</style></head><body>
<nav class="sidebar">
  <div class="sidebar-logo">📨 Invite Tracker</div>
  ${nav}
  <div class="sidebar-user">
    <div class="sidebar-username">${escapeHtml(user.username)}</div>
    ${permLabel(user.permLevel)}
    <a href="/auth/logout" class="logout-btn">Logout</a>
  </div>
</nav>
<main class="main"><h1>${escapeHtml(title)}</h1>${content}</main>
</body></html>`;
}

function loginPage(errorMsg = '') {
  const err = errorMsg ? `<div class="alert alert-danger">${escapeHtml(errorMsg)}</div>` : '';
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invite Tracker — Login</title><style>${CSS}
body{align-items:center;justify-content:center}.login{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:44px 36px;text-align:center;max-width:360px;width:90%}
.discord-btn{display:inline-flex;align-items:center;gap:10px;padding:12px 24px;background:var(--accent);color:#fff;border-radius:8px;font-size:15px;font-weight:700;margin-top:8px}
</style></head><body>
<div class="login">
  <div style="font-size:40px;margin-bottom:10px">📨</div>
  <h1 style="margin-bottom:6px">Invite Tracker</h1>
  <p style="color:var(--muted);margin-bottom:24px;font-size:14px">Sign in with Discord to continue</p>
  ${err}
  <a href="/auth/discord" class="discord-btn">Login with Discord</a>
</div></body></html>`;
}

function accessDeniedPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Access Denied</title><style>${CSS}
body{align-items:center;justify-content:center}</style></head><body>
<div class="card" style="text-align:center;max-width:380px">
  <h1 style="color:var(--red)">⛔ Access denied</h1>
  <p style="color:var(--muted);margin:12px 0 16px">You don't have permission to view this page.</p>
  <a href="/dashboard" style="color:var(--accent-2)">← Dashboard</a>
</div></body></html>`;
}

// Display helper: prefer a resolved username, fall back to the raw ID.
function nameOf(names, id) {
  if (!id) return '—';
  return names[id] ? escapeHtml(names[id]) : `<code>${escapeHtml(id)}</code>`;
}

function dashboardPage(user, overview, top, names) {
  const topRows = top.length
    ? top.map((r, i) => `<tr><td class="rank">${i + 1}</td><td class="uname">${nameOf(names, r.inviterId)}</td><td class="num">${r.total}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No invites tracked yet</td></tr>';

  const content = `
    <div style="margin-bottom:20px"><a href="/dashboard" class="btn btn-primary" style="font-size:13px;padding:7px 14px">🔄 Refresh</a></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Active invited</div><div class="stat-value" style="color:var(--green)">${overview.active}</div><div class="stat-sub">still in server</div></div>
      <div class="stat-card"><div class="stat-label">Total joins</div><div class="stat-value">${overview.totalJoins}</div><div class="stat-sub">all time</div></div>
      <div class="stat-card"><div class="stat-label">Left</div><div class="stat-value" style="color:var(--red)">${overview.leftTotal}</div></div>
      <div class="stat-card"><div class="stat-label">Fake</div><div class="stat-value" style="color:var(--yellow)">${overview.fakeTotal}</div></div>
      <div class="stat-card"><div class="stat-label">Inviters</div><div class="stat-value">${overview.inviters}</div></div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:16px 20px"><h2 style="margin:0">🏆 Top inviters</h2></div>
      <table><thead><tr><th>#</th><th>User</th><th class="num">Invites</th></tr></thead><tbody>${topRows}</tbody></table>
    </div>`;
  return layout('Dashboard', user, content, '/dashboard');
}

function leaderboardPage(user, rows, names) {
  const body = rows.length
    ? rows.map((r, i) => `<tr>
        <td class="rank">${['🥇','🥈','🥉'][i] ?? (i + 1)}</td>
        <td class="uname">${nameOf(names, r.inviterId)}</td>
        <td class="num"><strong>${r.total}</strong></td>
        <td class="num" style="color:var(--green)">${r.regular}</td>
        <td class="num" style="color:var(--red)">${r.leaves}</td>
        <td class="num" style="color:var(--yellow)">${r.fake}</td>
        <td class="num">${r.bonus}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No invites tracked yet</td></tr>';

  const content = `
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr>
        <th>#</th><th>User</th><th class="num">Total</th><th class="num">Real</th><th class="num">Left</th><th class="num">Fake</th><th class="num">Bonus</th>
      </tr></thead><tbody>${body}</tbody></table>
    </div>`;
  return layout('Leaderboard', user, content, '/leaderboard');
}

function memberPage(user, query, data, names) {
  let result = '';
  if (data) {
    const s = data.stats;
    const inv = data.invitedBy;
    let invBy;
    if (!inv) invBy = '— no record';
    else if (inv.source === 'vanity') invBy = '🔗 Vanity URL';
    else if (!inv.inviter_id) invBy = '❓ Unknown';
    else invBy = nameOf(names, inv.inviter_id);

    const listRows = data.list.length
      ? data.list.map(r => {
          const tag = r.left_at ? '<span class="badge badge-red">left</span>' : (r.fake ? '<span class="badge badge-yellow">fake</span>' : '<span class="badge badge-green">active</span>');
          const t = Math.floor(new Date(r.joined_at).getTime() / 1000);
          return `<tr><td class="uname">${nameOf(names, r.user_id)}</td><td>${tag}</td><td style="color:var(--muted);font-size:12px">${new Date(r.joined_at).toLocaleString()}</td></tr>`;
        }).join('')
      : '<tr><td colspan="3" class="empty">Has not invited anyone yet</td></tr>';

    result = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${s.total}</div></div>
        <div class="stat-card"><div class="stat-label">Real</div><div class="stat-value" style="color:var(--green)">${s.regular}</div></div>
        <div class="stat-card"><div class="stat-label">Left</div><div class="stat-value" style="color:var(--red)">${s.leaves}</div></div>
        <div class="stat-card"><div class="stat-label">Fake</div><div class="stat-value" style="color:var(--yellow)">${s.fake}</div></div>
        <div class="stat-card"><div class="stat-label">Bonus</div><div class="stat-value">${s.bonus}</div></div>
      </div>
      <div class="card"><h2>Invited by</h2><div style="font-size:15px">${invBy}</div></div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:16px 20px"><h2 style="margin:0">Invited members (${data.list.length})</h2></div>
        <table><thead><tr><th>User</th><th>Status</th><th>Joined</th></tr></thead><tbody>${listRows}</tbody></table>
      </div>`;
  }

  const content = `
    <div class="card">
      <form method="GET" action="/members">
        <div class="input-row">
          <div class="form-group"><label>Discord User ID</label>
            <input type="text" name="userId" placeholder="123456789012345678" value="${escapeHtml(query ?? '')}"></div>
          <button type="submit" class="btn btn-primary" style="white-space:nowrap">Look up</button>
        </div>
      </form>
    </div>
    ${result}`;
  return layout('Members', user, content, '/members');
}

function configPage(user, cfg, channelNames, saved, error) {
  const v = k => escapeHtml(cfg[k] ?? '');
  const roleIds = Array.isArray(cfg.moderator_role_ids) ? cfg.moderator_role_ids.join(', ') : (cfg.moderator_role_ids ?? '');
  const chOk = id => (id && channelNames[id]) ? `<span style="color:var(--green);font-size:12px;margin-left:8px">✓ #${escapeHtml(channelNames[id])}</span>` : '';

  const rewardRows = (Array.isArray(cfg.reward_roles) ? cfg.reward_roles : []).map(r => `
    <div class="reward-row">
      <input type="number" name="rewardInvites" value="${escapeHtml(r.invites ?? '')}" placeholder="Invites" min="1">
      <input type="text" name="rewardRole" value="${escapeHtml(r.role_id ?? '')}" placeholder="Role ID">
      <button type="button" class="btn-remove" onclick="this.closest('.reward-row').remove()">×</button>
    </div>`).join('');

  const content = `
    ${saved ? '<div class="alert alert-success">✅ Configuration saved — applied live.</div>' : ''}
    ${error ? `<div class="alert alert-danger">❌ ${escapeHtml(error)}</div>` : ''}
    <div class="card max-w">
      <h2>General</h2>
      <form method="POST" action="/config">
        <div class="form-group"><label>Server (Guild) ID</label><input type="text" name="guild_id" value="${v('guild_id')}"></div>
        <div class="form-group"><label>Moderator Role IDs</label>
          <input type="text" name="moderator_role_ids" value="${escapeHtml(roleIds)}" placeholder="123, 456">
          <div class="hint">Comma-separated. These roles can use moderation commands and the panel.</div></div>
        <div class="form-group"><label>Log Channel ${chOk(cfg.log_channel_id)}</label>
          <input type="text" name="log_channel_id" value="${v('log_channel_id')}" placeholder="Channel ID">
          <div class="hint">Join/leave attribution is logged here.</div></div>
        <div class="form-group"><label>Fake account age (days)</label>
          <input type="number" name="fake_min_age_days" value="${escapeHtml(cfg.fake_min_age_days ?? 7)}" min="0">
          <div class="hint">Joins from accounts younger than this (and rejoins) count as "fake". 0 disables age check.</div></div>

        <div class="switch-row">
          <div><div style="font-size:15px;font-weight:600;color:#fff">Count bots</div>
          <div class="hint" style="margin:0">Track bot joins too. Usually off.</div></div>
          <label class="toggle"><input type="checkbox" name="count_bots" value="1" ${cfg.count_bots ? 'checked' : ''}><span class="slider"></span></label>
        </div>

        <h2 style="margin-top:24px">Reward roles</h2>
        <div class="hint" style="margin:0 0 12px">Automatically grant a role when a user reaches an invite count (and remove it if they drop below).</div>
        <div id="reward-rows">${rewardRows}</div>
        <button type="button" class="btn btn-ghost" id="add-reward" style="font-size:13px;padding:8px 14px;margin-bottom:18px">+ Add reward role</button>

        <div><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    </div>
    <template id="reward-tpl">
      <div class="reward-row">
        <input type="number" name="rewardInvites" placeholder="Invites" min="1">
        <input type="text" name="rewardRole" placeholder="Role ID">
        <button type="button" class="btn-remove" onclick="this.closest('.reward-row').remove()">×</button>
      </div>
    </template>
    <script>
      document.getElementById('add-reward').addEventListener('click',function(){
        document.getElementById('reward-rows').appendChild(document.getElementById('reward-tpl').content.cloneNode(true));
      });
    </script>`;
  return layout('Config', user, content, '/config');
}

function linksPage(user, query, lookup, links, names) {
  let resultCard = '';
  if (query) {
    if (lookup && !lookup.notFound) {
      resultCard = `<div class="card">
        <h2 style="margin-bottom:10px">🔗 <code>${escapeHtml(lookup.code)}</code></h2>
        <div style="font-size:15px">Belongs to
          <a href="/members?userId=${encodeURIComponent(lookup.userId)}" class="uname" style="color:var(--accent-2)">${nameOf(names, lookup.userId)}</a>
          — <strong style="color:var(--green)">${lookup.active}</strong> active / ${lookup.total} total joins through this link.</div>
      </div>`;
    } else {
      resultCard = `<div class="alert alert-warn">No custom link with code <code>${escapeHtml(query)}</code> is tracked. It may be a normal server invite, the vanity URL, or a deleted custom link.</div>`;
    }
  }

  const rows = links.length
    ? links.map(l => `<tr>
        <td><code>${escapeHtml(l.code)}</code></td>
        <td class="uname"><a href="/members?userId=${encodeURIComponent(l.userId)}" style="color:var(--accent-2)">${nameOf(names, l.userId)}</a></td>
        <td class="num" style="color:var(--green)">${l.active}</td>
        <td class="num">${l.total}</td>
        <td style="color:var(--muted);font-size:12px;white-space:nowrap">${new Date(l.createdAt).toLocaleString()}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No custom links created yet</td></tr>';

  const content = `
    <div class="card">
      <form method="GET" action="/links">
        <div class="input-row">
          <div class="form-group"><label>Invite code</label>
            <input type="text" name="code" placeholder="e.g. aBcD1234" value="${escapeHtml(query ?? '')}"></div>
          <button type="submit" class="btn btn-primary" style="white-space:nowrap">Look up</button>
        </div>
        <div class="hint">Find who a custom <code>/createinvite</code> link belongs to. Leave empty to list every link.</div>
      </form>
    </div>
    ${resultCard}
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:16px 20px"><h2 style="margin:0">🔗 Custom links (${links.length})</h2></div>
      <table><thead><tr><th>Code</th><th>Owner</th><th class="num">Active</th><th class="num">Total</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  return layout('Links', user, content, '/links');
}

function logsPage(user, rows, names) {
  const body = rows.length
    ? rows.map(r => {
        let inviter;
        if (r.source === 'vanity') inviter = '🔗 Vanity';
        else if (!r.inviter_id) inviter = '❓ Unknown';
        else inviter = nameOf(names, r.inviter_id);
        const status = r.left_at ? '<span class="badge badge-red">left</span>' : (r.fake ? '<span class="badge badge-yellow">fake</span>' : '<span class="badge badge-green">active</span>');
        return `<tr>
          <td class="uname">${nameOf(names, r.user_id)}</td>
          <td>${inviter}</td>
          <td>${status}</td>
          <td style="color:var(--muted);font-size:12px;white-space:nowrap">${new Date(r.joined_at).toLocaleString()}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" class="empty">No events yet</td></tr>';

  const content = `
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr><th>Member</th><th>Invited by</th><th>Status</th><th>Joined</th></tr></thead><tbody>${body}</tbody></table>
    </div>`;
  return layout('Logs', user, content, '/logs');
}

module.exports = {
  escapeHtml, layout, loginPage, accessDeniedPage,
  dashboardPage, leaderboardPage, memberPage, linksPage, configPage, logsPage,
};
