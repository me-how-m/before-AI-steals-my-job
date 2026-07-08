# Phase 0 — setup checklist (do this once)

This is the only part that needs *your* hands: creating accounts, turning on 2FA,
and pasting secrets into Vercel. Everything after it is code that's already written.
Budget ~30–45 minutes. Nothing here can create a bill — every service below is a
hard-stopping free tier.

Work top to bottom. Check each box as you go.

---

## 1. Turn on 2FA everywhere ⚠️ (highest-value step — do it first)

The single biggest real risk to this project is someone getting into one of your
accounts. Enable 2FA / passkeys on **all five**:

- [ ] **GitHub** (holds the code) — Settings → Password and authentication
- [ ] **Vercel** (holds the deploy + secrets) — Account Settings → Authentication
- [ ] **Turso** (holds the data) — Account → Security
- [ ] **Cloudflare** (Turnstile anti-spam) — My Profile → Authentication
- [ ] **Your domain registrar** (if you attach a custom domain) — enable registrar lock + 2FA

## 2. Create the Turso database (free, no card)

- [ ] Install the CLI: `curl -sSfL https://get.tur.so/install.sh | bash`
- [ ] `turso auth signup`
- [ ] `turso db create beforeaistealsmyjob`
- [ ] Get the URL: `turso db show beforeaistealsmyjob --url` → this is `TURSO_DATABASE_URL`
- [ ] Mint a token: `turso db tokens create beforeaistealsmyjob` → this is `TURSO_AUTH_TOKEN`
- [ ] Apply the schema:
      ```sh
      TURSO_DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" npm run init-db
      ```
      You should see: `✓ Schema applied. Tables: feedback, notes, rate_limits`

## 3. Create the Cloudflare Turnstile keys (free anti-spam)

- [ ] Cloudflare dashboard → Turnstile → Add widget
- [ ] Domain: `beforeaistealsmyjob.vercel.app` (add your custom domain later if any)
- [ ] Copy the **Site Key** → `TURNSTILE_SITE_KEY` (public)
- [ ] Copy the **Secret Key** → `TURNSTILE_SECRET_KEY`

## 4. (Optional) Resend for the courtesy removal email

The removal link is shown on-screen regardless, so this is optional.

- [ ] Sign up at resend.com, verify a sending domain (SPF/DKIM)
- [ ] Create an API key → `RESEND_API_KEY`
- [ ] Pick a from-address on your verified domain → `RESEND_FROM`

## 5. Generate the app secrets

- [ ] Run: `npm run gen-secrets "a-strong-admin-passphrase"`
- [ ] It prints `EMAIL_ENC_KEY`, `HMAC_SECRET`, `SESSION_SECRET`, `RATE_LIMIT_SALT`,
      `CRON_SECRET`, `ADMIN_PASSWORD_HASH`, and `ADMIN_TOTP_SECRET`.
- [ ] Set up your authenticator app (Google Authenticator / Authy / 1Password) using the
      TOTP key it prints — **manual key entry is safest; don't paste the otpauth URI into any
      online QR generator.**

## 6. Put all the env vars into Vercel

- [ ] Vercel → Project `beforeaistealsmyjob` → Settings → Environment Variables
- [ ] Add every variable from `.env.example` (values from steps 2–5), for **Production**
      *and* **Preview**.
- [ ] Leave `MODERATION_MODE` empty for now (set it to `pending` later if you get spammed).

## 7. Deploy

- [ ] From the project folder: `vercel deploy --prod`
- [ ] Or connect the GitHub repo in the Vercel dashboard for auto-deploys (the CLI's
      auto-connect failed earlier because Vercel's GitHub app lacks access to `me-how-m`;
      granting it access fixes that).

## 8. Smoke-test production (2 minutes)

- [ ] Open the site — notes should load from the DB (empty wall at first is fine).
- [ ] Post a note → you should get the on-screen removal link; click it → confirm → it's gone.
- [ ] Open `/admin` → sign in with your passphrase + 6-digit code → you should see stats and
      your test note.
- [ ] Send yourself a feedback message via the bottom-right widget → it appears in the admin inbox.
- [ ] Confirm the page still looks right (if fonts or the Turnstile box look broken, the CSP in
      `vercel.json` may need loosening — see the note there).

Done. From here on, redeploys are just `git push` (if auto-deploy is connected) or
`vercel deploy --prod`.

---

### Local development / testing without any of the above
`npm install && npm run smoke` runs the whole backend against a throwaway local SQLite
file and prints a pass/fail report — no accounts, no cloud, no secrets needed.
