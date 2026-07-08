#!/usr/bin/env node
// Generates every secret Phase 0 needs and prints them as env-var lines.
// Usage:  node scripts/generate-secrets.mjs "your admin passphrase"
//   (or run with no arg and it will prompt)
//
// Nothing here is stored or sent anywhere — copy the output into Vercel's
// Environment Variables settings, then discard it.

import crypto from 'node:crypto';
import readline from 'node:readline';
import { hashPassword, base32Encode } from '../lib/crypto.js';

const hex = (n) => crypto.randomBytes(n).toString('hex');

async function getPassphrase() {
  const arg = process.argv[2];
  if (arg) return arg;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question('Choose an admin passphrase (min 12 chars): ', resolve)
  );
  rl.close();
  return answer;
}

const pass = (await getPassphrase()).trim();
if (pass.length < 12) {
  console.error('\n✗ Passphrase must be at least 12 characters. Aborting.');
  process.exit(1);
}

const totpSecret = base32Encode(crypto.randomBytes(20)); // 160-bit TOTP key
const issuer = 'BeforeAIStealsMyJob';
const account = 'admin';
const otpauth = `otpauth://totp/${issuer}:${account}?secret=${totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

console.log(`
# ─────────────────────────────────────────────────────────────
#  Paste these into Vercel → Project → Settings → Environment Variables
#  (Production + Preview). Then delete this output.
# ─────────────────────────────────────────────────────────────

# --- generated secrets ---
EMAIL_ENC_KEY=${hex(32)}
HMAC_SECRET=${hex(32)}
SESSION_SECRET=${hex(32)}
RATE_LIMIT_SALT=${hex(16)}
CRON_SECRET=${hex(24)}

# --- admin login ---
ADMIN_PASSWORD_HASH=${hashPassword(pass)}
ADMIN_TOTP_SECRET=${totpSecret}

# --- you still need to fill these in from the respective dashboards ---
# TURSO_DATABASE_URL=libsql://<your-db>.turso.io
# TURSO_AUTH_TOKEN=<from: turso db tokens create ...>
# TURNSTILE_SITE_KEY=<Cloudflare Turnstile site key (public)>
# TURNSTILE_SECRET_KEY=<Cloudflare Turnstile secret key>
# RESEND_API_KEY=<Resend API key>            # optional; removal link also shows on-screen
# RESEND_FROM=notes@yourdomain.com           # optional
# SITE_URL=https://beforeaistealsmyjob.vercel.app
# MODERATION_MODE=                           # set to "pending" to hold new notes for review

# ─────────────────────────────────────────────────────────────
#  Set up your authenticator app with EITHER:
#   • manual entry of this key:  ${totpSecret}
#   • or this otpauth URI (make a QR with 'qrencode', do NOT paste online):
#     ${otpauth}
# ─────────────────────────────────────────────────────────────
`);
