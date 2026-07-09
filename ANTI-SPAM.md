# Anti-spam, anti-gaming & content safety

How the wall stays clean without accounts. The philosophy: **layers of cheap
friction for machines, zero friction for humans**, and when in doubt, *hide for
review* rather than reject — a false positive should never eat someone's wish.

## The layers (in the order a request hits them)

| # | Layer | What it catches | Failure mode |
|---|-------|-----------------|--------------|
| 1 | **Cloudflare Turnstile** (invisible CAPTCHA, server-verified) | Bulk bots, headless browsers | Fails closed (403) |
| 2 | **Honeypot field** — a hidden `website` input humans never see | Dumb form-filling bots | Fake success: bot believes it posted; nothing is stored |
| 3 | **Time-to-submit trap** — UI reports ms between first keystroke and post; `<2.5s` or absent (direct API calls) is suspicious | Scripted/instant submissions | **Auto-pending**: stored `hidden`, awaits admin review — never rejected |
| 4 | **No-URL rule** — links (schemes, `www.`, bare domains on common TLDs) are blocked in notes and signatures | ~90% of comment spam (link drops) | 422 with a friendly reason; text handed back to edit |
| 5 | **Duplicate throttle** — exact same words (case-insensitive) already on the wall | Copy-paste floods, repost farming | 409 nudging to "+ me too" on the original |
| 6 | **PII & blocklist moderation** (see below) | Emails, phones, cards, IDs, blocklisted terms | 422 with reason |
| 7 | **Rate limits** — 5 posts/hr/IP, 60 "+1"/hr/IP, 5 feedback/hr/IP, 500 posts/hr sitewide; salted IP hashes only, purged after 30 days | Sustained abuse from one source | 429 |
| 8 | **Panic switch** — `MODERATION_MODE=pending` holds *every* new note for approval | A spam wave that beats layers 1–7 | Flip one env var, redeploy not needed for new posts |
| 9 | **Admin tools** — one-click hide/show, hard delete, people/AI source filter, search | Whatever slips through | Human judgment |

Layers 2–5 were chosen because they add **zero human friction**: a person typing
a wish never notices any of them.

### Honest limitations

- The time trap and honeypot are client-reported — a sophisticated, targeted bot
  can fake both. They exist to kill the *cheap* 95%; Turnstile + rate limits +
  pending-mode handle the expensive 5%.
- The duplicate check is exact-match; "I want to retire!" vs "I want to retire"
  passes. Fuzzy matching is a later upgrade if repost farming appears.
- Rate limits key on IP hashes: shared networks (universities) share a budget,
  VPN rotators get fresh ones. Acceptable at this scale.

## How people might boost their own entries — and the counters

| Strategy | Works today? | Counter (current → possible) |
|---|---|---|
| Tapping "+ me too" repeatedly | No | Client blocks repeats per browser (localStorage); server rate-limits 60 +1s/hr/IP |
| Clearing localStorage / incognito to re-vote | Somewhat (slowly) | 60/hr/IP cap makes it tedious → *upgrade: unique (note, ip-hash, day) table so re-votes are no-ops* |
| VPN/proxy rotation to farm +1s | Partially | Turnstile challenges datacenter IPs; rate limits per IP → *upgrade: Cloudflare proxy in front (bot score), unique-voter counting for trending* |
| Scripted +1 API calls | Mostly no | Rate limit + (upgrade) Turnstile on +1 past a per-IP threshold |
| Reposting their wish many times | No | Duplicate throttle (409); near-duplicates visible to admin via search |
| Posting at multiple "fresh" times to ride Recent | Somewhat | 5 posts/hr/IP; Recent shows only 10; admin hide |
| Brigading (sharing "go +1 my wish" links) | Yes — by design | That's virality, not abuse. If it distorts *trending*, switch trending to unique-voters-per-day |
| Timing around the nightly trending decay | Marginal | plus_recent halves nightly; a cap on per-IP contribution per note would close it |

**Planned first upgrade if gaming appears:** count trending by *unique daily
voters* instead of raw +1s — one small table, kills every vote-farming strategy
at once.

## Toxic content & PII — current protections

**Always blocked in notes *and* signatures** (`lib/moderation.js`):
- Email addresses (regex)
- Phone numbers (international-ish formats)
- Card numbers (13–19 digit runs that pass the Luhn check — near-zero false positives)
- National-ID-shaped numbers (SSN pattern)
- URLs / bare domains
- Terms in `BLOCKLIST_TERMS` (env var, comma-separated, whole-word, case-insensitive — tune without redeploying)

**Plus:** 240-char cap, all rendering via `textContent` (no XSS), CSP headers,
`pending` panic switch, admin hide/delete, and self-service removal links.

**Known gaps / how to strengthen (in priority order):**
1. `BLOCKLIST_TERMS` ships empty — populate it with a starter slur/harassment list (kept out of the repo on purpose; it lives in the env var).
2. **Leetspeak/diacritic normalization** before matching (`f_u_c_k`, `fυck`) — cheap to add.
3. **Obfuscated PII** ("john at gmail dot com", spelled-out digits) — regexes miss these; a normalization pass catches most.
4. **LLM moderation pass** (e.g., Claude Haiku on each pending note) — near-perfect toxicity catch, costs fractions of a cent per note; natural fit with auto-pending.
5. **Public "report" button** → N reports auto-hides a note pending review — turns readers into moderators.
6. Non-Latin-script PII patterns if the wall goes international.

## Routing through Cloudflare's proxy (the big anti-abuse upgrade)

Free, and puts Cloudflare's bot detection *in front of* Vercel. Worth doing when
spam/DDoS outgrows the app-level layers — not before (it adds a moving part).

1. Cloudflare dashboard → **Add a site** → `beforeaistealsmyjob.space` → Free plan. It imports your DNS records.
2. At **Namecheap** → Domain → Nameservers → **Custom DNS** → enter the two nameservers Cloudflare assigns (e.g. `ada.ns.cloudflare.com` / `bob.ns.cloudflare.com`). Propagation: minutes–hours.
3. In Cloudflare DNS, keep the records as imported — `A @ 76.76.21.21`, `CNAME www cname.vercel-dns.com` — **start with the cloud icon grey (DNS-only)** and confirm the site + SSL still work.
4. Cloudflare → **SSL/TLS → set mode to "Full (strict)"** (critical — "Flexible" causes redirect loops with Vercel).
5. Flip the cloud icons to **orange (proxied)**. Now traffic passes through Cloudflare's edge.
6. Turn on **Security → Bots → Bot Fight Mode**, and optionally add WAF rate-limiting rules (e.g., >10 POSTs to `/api/*` per minute per IP → managed challenge).

Caveats: Turnstile keeps working (any-hostname widgets unaffected; hostname-scoped ones already list the domain). Vercel's cert renews fine behind "Full (strict)". If anything misbehaves, flipping the clouds back to grey instantly reverts to today's setup.

## Freshness vs. free-tier budget (for reference)

`/api/wall` (wall + all three widget lists) is CDN-cached with `s-maxage=300` —
~288 origin rebuilds/day ≈ 1–2% of Turso's free 500M row-reads/month, regardless
of visitor count. The widget shows "refreshed X min ago" from the payload's
`generatedAt`, and open tabs re-fetch every 5 minutes (CDN hit, zero DB cost).
Dropping to 60s would still use <10% of budget; below 30s not recommended.
