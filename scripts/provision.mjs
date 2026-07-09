#!/usr/bin/env node
// One-shot provisioning: reads the Turso + Turnstile values from the project
// root .env.local, generates all app secrets + admin 2FA, and writes two local
// (gitignored) files — WITHOUT printing any secret to stdout:
//
//   .env.vercel           → all env vars, ready to load into Vercel
//   ADMIN-CREDENTIALS.txt → the admin passphrase + TOTP enrollment
//
// Run:  npm run provision

import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { hashPassword, base32Encode } from '../lib/crypto.js';

const src = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
const grab = (re) => { const m = src.match(re); return m ? m[1].trim() : ''; };

// NB: the TURSO_AUTH_TOKEN regex requires '=' right after the name, so it does
// NOT match the management token stored as TURSO_AUTH_TOKEN_FULL.
const dbToken = grab(/^TURSO_AUTH_TOKEN[ \t]*=[ \t]*(.+)$/m);
const dbUrl = grab(/^(libsql:\/\/\S+)/m);
const tsSite = grab(/^Site key[ \t]*:[ \t]*(.+)$/im);
const tsSecret = grab(/^Secret key[ \t]*:[ \t]*(.+)$/im);

const missing = Object.entries({ dbUrl, dbToken, tsSite, tsSecret })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('✗ Could not parse from .env.local:', missing.join(', '));
  process.exit(1);
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
const totpSecret = base32Encode(crypto.randomBytes(20));

const WORDS = [
  'anchor','amber','basil','birch','breeze','cedar','cinder','clay','cliff','clover',
  'copper','coral','cove','dawn','delta','drift','ember','fable','fern','flint',
  'gale','glade','granite','harbor','hazel','heron','indigo','ivory','juniper','kite',
  'lark','linen','lotus','maple','marble','meadow','mica','moss','nimbus','oak',
  'onyx','opal','orchard','pebble','pine','quartz','quill','raven','reef','ridge',
  'river','sable','sage','slate','sparrow','spruce','stone','thistle','tide','topaz',
  'umber','vale','willow','zephyr',
];
const pick = () => WORDS[crypto.randomInt(WORDS.length)];
const passphrase = `${pick()}-${pick()}-${pick()}-${pick()}-${crypto.randomInt(100, 1000)}`;

const env = {
  TURSO_DATABASE_URL: dbUrl,
  TURSO_AUTH_TOKEN: dbToken,
  TURNSTILE_SITE_KEY: tsSite,
  TURNSTILE_SECRET_KEY: tsSecret,
  EMAIL_ENC_KEY: hex(32),
  HMAC_SECRET: hex(32),
  SESSION_SECRET: hex(32),
  RATE_LIMIT_SALT: hex(16),
  CRON_SECRET: hex(24),
  ADMIN_PASSWORD_HASH: hashPassword(passphrase),
  ADMIN_TOTP_SECRET: totpSecret,
  SITE_URL: 'https://beforeaistealsmyjob.vercel.app',
};

const envText = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
await writeFile(new URL('../.env.vercel', import.meta.url), envText);

const otpauth = `otpauth://totp/BeforeAIStealsMyJob:admin?secret=${totpSecret}&issuer=BeforeAIStealsMyJob&algorithm=SHA1&digits=6&period=30`;
const creds =
  `BEFORE AI STEALS MY JOB — ADMIN LOGIN\n` +
  `(keep this secret; do NOT commit; delete after saving to a password manager)\n\n` +
  `Passphrase:            ${passphrase}\n` +
  `TOTP secret (manual):  ${totpSecret}\n` +
  `otpauth URI:           ${otpauth}\n\n` +
  `Enroll the TOTP secret in your authenticator app via MANUAL key entry.\n` +
  `To change the passphrase later: npm run gen-secrets "new passphrase" and\n` +
  `update ADMIN_PASSWORD_HASH in Vercel.\n`;
await writeFile(new URL('../ADMIN-CREDENTIALS.txt', import.meta.url), creds);

console.log('✓ parsed .env.local  →  dbUrl(%d) dbToken(%d) siteKey(%d) secretKey(%d)',
  dbUrl.length, dbToken.length, tsSite.length, tsSecret.length);
console.log('✓ wrote .env.vercel  →', Object.keys(env).join(', '));
console.log('✓ wrote ADMIN-CREDENTIALS.txt (passphrase + TOTP) — open it, save it, delete it');
