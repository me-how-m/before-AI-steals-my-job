# Failure-mode review — Before AI steals my job…

A frank list of the ways this project could fail, how exposed it is to each, and
what's already in place (or planned) to contain it. Ordered roughly by likelihood
× impact. "✅ in code" = handled by what's in this repo; "⚙️ ops" = something you
do in a dashboard; "📌 todo" = deliberately deferred.

## The one-line summary

Nothing here can generate a surprise bill (every tier hard-stops), and nothing a
visitor types can take the site down (reads are CDN-cached; writes are rate-limited
and fail open). The biggest *real* risk is boring: an attacker getting into one of
your accounts because 2FA wasn't on. Fix that first.

---

## 1. Viral traffic / bandwidth spike
**Exposure:** front page of Reddit → 1M+ hits in a day.
**Why it's contained:** the whole page is ~50 KB of static assets, and the only
dynamic read (`/api/wall`) is CDN-cached for 5 min (`s-maxage=300` + SWR). So a
million visitors collapse to a few hundred origin hits and ~288 DB reads/day.
Vercel Hobby has **no card on file — it pauses, it never bills.**
**Controls:** ✅ CDN cache header · ✅ tiny payload · ⚙️ upgrade to Pro ($20) or move
static assets to Cloudflare Pages if you ever hit Hobby's 100 GB bandwidth.
**Residual:** a pause is possible under extreme load; that's a $20 decision, not a debt.

## 2. Account takeover (Vercel / GitHub / Turso / Resend / DNS)
**Exposure:** total — whoever owns the account owns the site and the data.
**This is the highest-leverage risk in the whole document.**
**Controls:** ⚙️ **enable 2FA / passkeys on all five accounts (Phase 0, day one)** ·
⚙️ unique passwords · ⚙️ no shared recovery email · ✅ app secrets live only in Vercel
env vars, never in the repo.
**Residual:** DNS registrar is the sneakiest — lock it and turn on registrar 2FA too.

## 3. Admin-panel breach
**Exposure:** read all notes/emails, hide or delete content.
**Controls:** ✅ passphrase hashed with scrypt · ✅ **TOTP 2FA required** · ✅ login
rate-limited to 5 / 15 min per IP · ✅ short-lived (12 h) signed HttpOnly session
cookie · ✅ constant-time credential comparison · ✅ `/admin` is `noindex`.
**Residual:** 📌 optional IP allowlist if you want belt-and-braces.

## 4. Spam / offensive content flood
**Exposure:** reputational; moderation workload.
**Controls:** ✅ Cloudflare Turnstile on every post · ✅ per-IP (5/h) + global (500/h)
rate limits · ✅ one-click **hide** in admin · ✅ **panic switch**: set
`MODERATION_MODE=pending` and new notes are held (hidden) until you approve them.
**Residual:** 📌 a profanity/PII blocklist is easy to add if volume warrants.

## 5. Takedown / legal complaint (defamation, PII in a note, GDPR erasure)
**Exposure:** legal liability from user-generated content.
**Controls:** ✅ Contact link published · ✅ admin **hide** = instant takedown · ✅ admin
**hard delete** wipes text + author + email (keeps an id tombstone for audit) · ✅ email
stored **encrypted** while the note lives, so you *can* correlate a note to a person for
a data-subject request · ✅ removal via signed link needs no account.
**Residual:** 📌 publish a short privacy note + terms; commit to erasure within 72 h.

## 6. Data loss (Turso free tier has no point-in-time restore)
**Exposure:** notes gone, no rollback.
**Controls:** ✅ nightly cron + one-click admin **export** (JSON/CSV/TXT); ✅ it's plain
SQLite — trivially portable.
**Residual:** 📌 wire the nightly cron to push the export into object storage (S3/R2) so
backups are off-box, not just on-demand.

## 7. Email cap / deliverability (Resend free = 100/day)
**Exposure:** removal emails delayed or undelivered.
**Why it barely matters:** the removal link is **shown on-screen at post time** and
copyable — email is a courtesy duplicate, never the only path.
**Controls:** ✅ on-screen removal link · ✅ email fully optional · ⚙️ verify your sending
domain (SPF/DKIM) · ⚙️ swap Resend → Amazon SES (~$0.10 / 1k) past 100/day.

## 8. XSS / SQL injection via note or feedback text
**Exposure:** session theft, defacement.
**Controls:** ✅ all user text rendered with `textContent`, never `innerHTML` (front page
*and* admin table) · ✅ every query is parameterized (`?` args, no string-built SQL) · ✅
CSP header restricts scripts to self + Turnstile · ✅ note length capped (240 / 1000).

## 9. Turso free-tier limits hit (5 GB / 500M reads / 10M writes per mo)
**Exposure:** DB stops accepting work — hard stop, $0.
**Controls:** ✅ reads are CDN-cached (~9k/mo, vs a 500M cap) · ✅ writes are rate-limited ·
✅ if the DB is unreachable the wall serves its **bundled fallback notes**, never a blank page.

## 10. Vercel Hobby "non-commercial" terms
**Exposure:** project suspension if the site is monetized on a Hobby plan.
**Controls:** ⚙️ if you ever add ads/revenue, upgrade to Pro *first*. Until then, fine.

## 11. Secrets leaked via the repo
**Exposure:** key compromise.
**Controls:** ✅ `.gitignore` covers `.env*`, `.vercel`, `node_modules` · ✅ no secret is
ever hard-coded — everything reads from `process.env` · ⚙️ rotate keys on any suspicion
(they're all regenerable via `npm run gen-secrets`).

## 12. Vendor shutdown / lock-in
**Exposure:** a provider disappears or changes terms.
**Controls:** ✅ data is portable SQLite + JSON exports · ✅ the front end is static and runs
on any host · ✅ the API uses only standard Node + one swappable DB client. Migration is a
day, not a rewrite.

---

### What "done" looks like for hardening (Phase 4)
Off-box nightly backup · privacy + terms pages · profanity/PII filter · optional admin IP
allowlist · self-hosted fonts (removes the Google Fonts third-party + tightens CSP).
