# Invite Tracker Bot

A self-hosted Discord invite tracker: join attribution, leaderboards, join/leave
logs, reward roles, invite-gated giveaways, and a Discord-OAuth web panel.

Built with Node.js 20+, discord.js v14, PostgreSQL and Express. The bot's
user-facing messages are in Georgian; the web panel is in English.

## How attribution works
Discord has no "user X used invite Y" event, so the bot keeps a snapshot of
every invite's use count and, on each join, finds the invite whose count went
up (or one that vanished at max-uses). Vanity URLs and "couldn't determine"
(e.g. two invites changed at once, or a restart mid-join) are handled too.

## Categories
Per inviter: **real** (present, not fake), **left**, **fake**, **bonus**
(manual). `total = real + bonus`.

A join only counts as **real** when **all** of these hold — otherwise it's
flagged **fake** (and excluded from the total):
- the account is **older than the configured age** (`fake_min_age_days`, default 7)
- it's **not a self-invite** (the member didn't join through their own code)
- it's the member's **first time joining** (any prior join = rejoin = fake)

## Commands
- `/invites [user]` — invite stats + breakdown
- `/leaderboard` — top inviters (with a server overview block)
- `/smartleaderboard` (mod) — posts an auto-refreshing leaderboard in the current
  channel, pins it, and edits it in place every minute. Survives restarts (one
  per server; re-running replaces the old one). Carries two buttons: **My
  invites** (shows the clicker their own stats privately) and **Create link**
  (generates their personal, never-expiring invite — same as `/createinvite`).
- `/createinvite` — generates the member's **own** personal invite link (never
  expires, unlimited uses). The bot creates the invite and remembers who asked, so
  every join through it is credited to that member even though Discord lists the
  bot as the technical creator. Re-running returns the same link.
- `/invited-by <user>` — who invited someone
- `/invited-list [user]` — who someone invited
- `/addbonus <user> <amount>` / `/removebonus <user> <amount>` (mod)
- `/reassign <member> <inviter> [code]` (mod) — credit a member's join to the
  real inviter as a **real** invite, not a bonus. For fixing joins that were
  logged Unknown (e.g. a personal link whose use-count lagged).
- `/trackinvite <invite> <channel> [label]` (mod) — bind a specific invite code
  (raw code or URL) to a channel; every join through that code is logged there
  with a running count.
- `/untrackinvite <invite>` (mod) — stop tracking a code
- `/trackedlinks` (mod) — list tracked links with per-link join stats
- `/leaderboardhide` (mod) — hide people from **both** `/leaderboard` and the
  smart board:
  - `user add|remove <user>` — hide/unhide a specific user
  - `role add|remove <role>` — hide/unhide everyone holding a role
  - `list` — show what's currently hidden

  Hiding only affects the ranking list — individual `/invites` lookups and the
  server-overview totals are unaffected.

## Giveaways
Invite-gated giveaways: anyone who gains enough **new real invites** after a
giveaway starts is auto-entered — no command for members, they just invite. The
giveaway embed has a **My participation** button members can click to privately
see their eligible-invite count and whether they're in.

- `/giveaway start <prize> <duration> <invites> [channel]` (mod) — post a giveaway
  embed. `duration` accepts `7d`, `72h`, `1w`, `90m`, or a bare number = days
  (max 60d). The bot picks a random winner automatically when it ends.
- `/giveaway end <id>` (mod) — end now and draw a winner
- `/giveaway reroll <id>` (mod) — draw a new winner (excludes the previous one)
- `/giveaway cancel <id>` (mod) — cancel with no winner
- `/giveaway list` (mod) — show recent giveaways and their status/winner

Entries are **stored, not recomputed**: a member is frozen into the giveaway the
moment they cross the threshold. Qualifying counts **real** invites only, with
the invitee present at the time, and only invites gained **since that giveaway
started**. Once entered, members stay in even if an invitee later leaves; staff
(admins / moderator roles) are excluded. Everything survives restarts — on
startup a backfill records entries earned while the bot was down, and the draw
still fires for a giveaway whose end time elapsed during downtime.

## Logs
The configured log channel receives member joins (with attribution), member
leaves, and new invite-link creations (creator, code, target channel, max uses,
expiry). Tracked links additionally log their own joins to their bound channel.

## Web panel
Dashboard, Leaderboard, Members lookup, Links (look up who a `/createinvite`
link belongs to), Logs, and Config (log channel, moderator roles, fake-age
threshold, reward roles). Login is via Discord OAuth2; server Administrators and
configured moderator roles get access, and Config is admin-only. Access is
re-checked against the guild every few minutes, so removing a role revokes panel
access. Sessions are stored in Postgres.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in.
3. Enable the **Server Members Intent** in the Developer Portal, and give the bot
   the **Manage Server** permission in the guild (required to read invites).
4. For the web panel, add `<WEB_URL>/auth/callback` as an OAuth2 redirect URI.
5. `npm start` (or build the included `Dockerfile`).

All tables are prefixed `invite_*`, so the bot can share a Postgres instance
with other apps.

## Environment variables
| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | yes | Discord bot token |
| `DATABASE_URL` | yes | PostgreSQL connection string (connects over SSL) |
| `GUILD_ID` | yes* | Server to track (*or set `guild_id` in `src/config/config.json`) |
| `OWNER_IDS` | no | Comma-separated user IDs with full access |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | panel | OAuth2 application credentials |
| `WEB_URL` | panel | Public base URL of the panel (`https://` enables secure cookies) |
| `SESSION_SECRET` | panel | Long random string used to sign session cookies |
| `PORT` | no | Web panel port (default `3000`) |

Log channel, moderator roles, fake-account age, bot counting and reward roles
live in `src/config/config.json` and can be changed live from the panel's Config
page (persisted to the database).

## License
[MIT](LICENSE)
