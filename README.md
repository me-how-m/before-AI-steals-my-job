# Before AI steals my job…

An anonymous wall of things people want to do before AI steals their job. Handwritten notes drift across an animated gradient — raises never asked for, inboxes never cleared, resignation letters never sent. You can open any of them, add a "+ me too", copy them — or leave your own. And yes, it was built by AI.

Live: **https://beforeaistealsmyjob.vercel.app**

## Architecture

A static front end with a thin serverless API and a tiny SQLite-class database. Chosen to be **reliable and genuinely free at rest, with no path to a surprise bill** — every service hard-stops instead of charging.

- **Front end** — static HTML/CSS/vanilla JS. No build step, no framework.
- **API** — Vercel serverless functions (Node), one dependency (`@libsql/client`).
- **Database** — [Turso](https://turso.tech) (libSQL/SQLite). Free tier: 5 GB, 500M reads/mo.
- **Anti-spam** — Cloudflare Turnstile (invisible CAPTCHA) + per-IP/global rate limits.
- **Email** — Resend (optional; the removal link is also shown on-screen).

**The scaling trick:** readers never touch the database. The whole front page comes from
one endpoint, `/api/wall`, which returns a ~200-note sample plus the widget lists and is
**CDN-cached for 5 minutes**. A million visitors a day collapse to a few hundred origin
hits and ~288 DB reads — so any free database survives being on the front page of Reddit.
If the DB is ever unreachable, the page falls back to bundled notes and never looks broken.

**No accounts.** Ownership is proved by capability, not login: leaving an email (encrypted
at rest) gets you a signed removal link; that link — also shown on-screen at post time — is
all it takes to remove a note later.

## Features

- **Floating notes** — 10 rows drift at different speeds, spaced so they never overlap, fading in toward the center and out toward the edges.
- **Composer** with a two-step post flow — sign it or stay anonymous, then optionally leave an email; Turnstile-verified.
- **Note detail** — full text, author, time, "+ me too", copy.
- **Trending widget** (top-right) — Trending / Top 10 / Most recent, fed from the same cached payload (no extra requests).
- **Feedback widget** (bottom-right) — messages/requests that land in the admin inbox.
- **Admin dashboard** (`/admin`) — passphrase + TOTP 2FA; browse/search notes, hide/show, GDPR delete, live stats, export (JSON/CSV/TXT), feedback inbox.
- **Self-service removal** — signed link, no account.

## Layout

```
index.html · styles.css · app.js · data.js   front page (data.js = offline fallback)
admin.html · admin.css · admin.js             admin dashboard
api/        wall, notes, plus, remove, feedback, admin, cron/daily
lib/        db, crypto, http, ratelimit, turnstile, email, notes  (shared helpers)
db/schema.sql                                 database schema
scripts/    gen-secrets, init-db, smoke-test
vercel.json                                   crons, security headers, /admin rewrite
```

## Setup & running

- **Deploying it for real:** follow **[PHASE-0-SETUP.md](PHASE-0-SETUP.md)** (accounts, 2FA, secrets, deploy). ~30–45 min, all free tiers.
- **Local backend test — no cloud needed:** `npm install && npm run smoke` runs the entire API against a throwaway local SQLite file and prints a pass/fail report.
- **Front end only:** open `index.html` (or `python3 -m http.server`); with no API reachable it runs in fallback mode.
- **Risk review:** see **[FAILURE-MODES.md](FAILURE-MODES.md)**.

## Cost

$0/month at rest and under normal load. The first paid dollar is opt-in: Vercel Pro ($20)
if you outgrow the Hobby bandwidth, or Amazon SES (cents) if you send more than 100 removal
emails a day. Turso and Cloudflare Turnstile stay free.

---

A themed variant of [before-I-die](https://github.com/me-how-m/before-I-die), originally mocked up with Claude Design (claude.ai/design) and implemented by Claude Code.
