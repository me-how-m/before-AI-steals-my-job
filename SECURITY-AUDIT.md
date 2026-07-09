# Security, cybersecurity & UX audit

Date: 2026-07-09. Scope: the deployed app (front end, `/api/*`, `lib/*`, config)
at beforeaistealsmyjob.space. Method: manual source review of the current code +
config, cross-checked against live behaviour. Severity = likelihood × impact for
*this* app (an anonymous art wall, no money, minimal PII).

**Headline:** one High finding (IP-header trust defeats all rate limiting),
otherwise the app is in good shape — parameterised SQL, no innerHTML for user
data, hashed+2FA admin, encrypted email at rest. The biggest real risks are
operational (secrets that passed through a chat transcript) and accessibility
(no reduced-motion support).

Counts: **High 2 · Medium 4 · Low 7 · Info 4** · plus "what's already solid".

---

## Vulnerabilities

### V1 — IP is taken from a client-spoofable header (High)
`lib/http.js:50` — `clientIp()` returns the **first** token of `X-Forwarded-For`.
That token is attacker-controlled: a script can send `X-Forwarded-For: <random>`
on every request and be seen as a new IP each time. Because every rate limit and
the admin brute-force guard key on `hashIp(clientIp(req))`, this **defeats them
all at once**:
- `/api/notes` 5/hr, `/api/plus` 60/hr, `/api/feedback` 5/hr → effectively unlimited.
- `/api/admin?action=login` 5/15min brute-force guard → bypassable (still backed by scrypt + TOTP, so online guessing stays impractical — but the guard is the layer that's meant to stop it).
- Combined with V5, enables unlimited "+1" vote farming → trending/counter gaming.

**Fix:** trust the platform-set header instead. On Vercel, `x-real-ip` is the real
client IP as seen by the edge and cannot be spoofed; fall back to the *last* XFF
token, then the socket. E.g.:
```js
export function clientIp(req) {
  const real = req.headers?.['x-real-ip'];
  if (real) return String(real).trim();
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) { const p = String(xff).split(','); return p[p.length - 1].trim(); }
  return (req.socket?.remoteAddress || 'unknown').trim();
}
```
(Confirm `x-real-ip` is populated in this project's runtime before relying on it —
Vercel sets it, but it's worth a one-line check.)

### V2 — No HSTS header (Medium)
`vercel.json` sets CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-
Policy — but **not** `Strict-Transport-Security`. Without it, a first-visit
SSL-strip / downgrade is possible. **Fix:** add
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
(Only add `preload` if you're ready to commit the apex + subdomains to HTTPS
permanently.)

### V3 — Moderation runs before the human check (Low)
`api/notes.js:28-37` evaluates `moderate()` (PII/link/blocklist regexes) *before*
`verifyTurnstile()`. So an unauthenticated caller can probe the filter rules for
free (a blocklist oracle) and spend a little server CPU without solving the
CAPTCHA. Low impact. **Fix:** move the Turnstile check to the top of the handler.

### V4 — Honeypot & time-trap give ~zero protection against a targeted script (Low)
`api/notes.js` honeypot (`website`) and time-trap (`elapsedMs`) are both
client-reported. A direct API caller simply omits `website` and sends
`elapsedMs: 5000`. This is *documented* in ANTI-SPAM.md and they're intended as
cheap filters for dumb bots — but it means **Turnstile is the only real gate on
posting**, so its correctness matters a lot (see V1's interaction and the recent
110200 incident).

### V5 — `/api/plus` has no human verification (Low)
`api/plus.js` gates "+1" only with the (spoofable, per V1) rate limit — no
Turnstile. With V1 fixed the rate limit becomes real; without it, vote farming is
trivial. **Fix:** fix V1; optionally move trending to unique-voter-per-day
counting (already noted in ANTI-SPAM.md) and/or add Turnstile past a per-IP
threshold.

### V6 — Host-header could poison removal-link URLs *if* SITE_URL were unset (Info)
`lib/http.js:56` `siteUrl()` uses `SITE_URL` when set (it is, in prod) and
otherwise trusts the `Host` header. If `SITE_URL` were ever removed, an attacker
could set `Host:` to get a removal *email* pointing at their domain. Mitigated
today; keep `SITE_URL` set.

### V7 — Removal tokens don't expire and ride in the URL (Info)
`HMAC(id)` capability tokens never expire and appear in the removal URL (emailed
+ shown). URLs can leak via browser history / referrer. This is the intended
account-less design; acceptable. Optionally add an `exp` claim.

### V8 — CSP allows `'unsafe-inline'` styles (Info)
Needed for inline `<style>` on the legal pages and JS-set `style` attributes.
Low risk since **no user-supplied HTML is ever rendered** (all `textContent`).
Could be tightened with hashes/nonces later.

### V9 — Admin session is an un-revocable 12h bearer token (Info)
`lib/crypto.js` sessions are signed `{exp}` cookies (HttpOnly, Secure,
SameSite=Strict). There's no server-side revocation: a stolen cookie is valid
until it expires or you rotate `SESSION_SECRET` (which logs the single admin out
everywhere — an acceptable "panic logout").

---

## Cybersecurity / operational

- **O1 — Secrets exposed in a chat transcript (High, known).** The Turso DB token
  and the *old* Turnstile secret passed through this session. Rotate the Turso
  token (and revoke `TURSO_AUTH_TOKEN_FULL`, the management token); the Turnstile
  secret is already rotated via the new widget — delete the old widget.
- **O2 — Turso DB token expires ~early Sept 2026 (Medium).** Hard availability
  cliff: the site loses its database when it lapses. Mint a non-expiring token
  (`turso db tokens create … --expiration none`) and swap it in — fold into O1.
- **O3 — No edge WAF / rate limiting (Low).** All abuse controls are app-level and
  (per V1) bypassable. The Cloudflare-proxy path in ANTI-SPAM.md is the fix when
  spam warrants it.
- **O4 — No monitoring/alerting (Low).** No signal on error spikes, 429 floods, or
  a sudden inflow of `pending` notes. Vercel logs + a simple alert would help.
- **O5 — Small dependency surface (Good).** One runtime dep (`@libsql/client`).
  Run `npm audit` periodically; keep it pinned.
- **O6 — Fail-open on missing config (Config).** `verifyTurnstile`, the cron auth,
  and the rate limiter all fail *open* if their env var is unset. Fine while the
  env is complete; a missing var silently disables a control rather than breaking
  loudly. Consider asserting required envs at boot.

---

## UX / accessibility

- **U1 — No `prefers-reduced-motion` (Medium, a11y).** Four blurred blobs plus ~50
  constantly drifting notes animate nonstop, with no way to opt out. This can
  trigger motion sickness / vestibular symptoms. **Fix:** a
  `@media (prefers-reduced-motion: reduce)` block that pauses the blob keyframes
  and the note drift (render them static/positioned instead).
- **U2 — ~50 drifting notes are all tab-focusable buttons (Medium, a11y).** A
  keyboard user must tab through dozens of *moving* targets before reaching the
  composer, and screen readers announce a churn of buttons. **Fix:** `tabindex="-1"`
  + `aria-hidden` on the drifting layer (it's decorative/ambient), and treat the
  Trending widget as the accessible, ordered way to reach notes.
- **U3 — Modals lack focus trapping / focus return (Low, a11y).** Escape and
  click-out work, but focus isn't trapped inside open modals nor restored to the
  trigger on close.
- **U4 — Faded notes fail contrast (Low, a11y).** Low-opacity side notes over the
  gradient likely miss WCAG AA. They're decorative; the primary text (modal,
  composer) is fine.
- **U5 — Posting friction (Low, UX).** A one-line wish takes: expand composer →
  submit → 2-step sign/email modal → Turnstile → post. Reasonable for the concept,
  but it's the main drop-off point; consider collapsing sign+email into one step.
- **U6 — Load flash (Low, UX).** The counter starts at the vanity `124,583` and the
  bundled fallback notes show for a beat before the live wall/counter swap in.
  Could hold the counter until the first `/api/wall` resolves.
- **U7 — Recently fixed (Good).** Mobile overlap/visibility, the counter + trending
  widget crash, the admin login field, and the post-login layout are all resolved.

---

## What's already solid (credit where due)

- **SQL injection:** every query is parameterised; filters/sorts use whitelists, not
  interpolation.
- **XSS:** all user text rendered via `textContent` (front page *and* admin table);
  the removal confirm page escapes its token; CSP restricts scripts to self + Turnstile.
- **Admin auth:** scrypt password + TOTP 2FA, constant-time compares, HttpOnly/Secure/
  SameSite=Strict session, `/admin` noindexed.
- **Data at rest:** emails AES-256-GCM encrypted; IPs stored only as salted hashes,
  purged after 30 days; hard-delete wipes content and keeps only an ID tombstone.
- **Abuse:** Turnstile + honeypot + time-trap + duplicate throttle + moderation +
  pending panic switch (layered; see ANTI-SPAM.md).
- **Prefetch safety:** removal is GET-confirm / POST-delete.

---

## Suggested fix order

1. **V1** (client-spoofable IP) — small change, restores every rate limit + the admin guard.
2. **O1 + O2** (rotate Turso token to a non-expiring one; delete old Turnstile widget).
3. **V2** (HSTS) + **U1** (reduced-motion) + **U2** (floaters out of tab order) — quick, high-value.
4. **V3** (Turnstile before moderation), **U3–U6** polish, **O4** monitoring — as time allows.

For a deeper, independent adversarial pass, `/code-review ultra` runs a multi-agent
cloud review of the branch.
