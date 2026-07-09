#!/usr/bin/env node
// Local integration test — no cloud needed. Spins up a file-backed libSQL DB,
// applies the schema, wires fake secrets, then drives the real API handlers
// end to end. Run:  npm install && npm run smoke
//
// Covers: crypto primitives, wall/notes/plus/remove, admin auth + TOTP + the
// management actions. Exits non-zero on any failure.

import crypto from 'node:crypto';
import os from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import {
  base32Encode, base32Decode, hashPassword, encryptEmail, decryptEmail,
  signToken, verifyToken, verifyPassword, verifyTOTP, createSession, verifySession,
} from '../lib/crypto.js';
import { moderate } from '../lib/moderation.js';

// ---- environment (must be set before importing handlers) ----
const dbPath = join(os.tmpdir(), `smoke-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
process.env.EMAIL_ENC_KEY = crypto.randomBytes(32).toString('hex');
process.env.HMAC_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.RATE_LIMIT_SALT = crypto.randomBytes(16).toString('hex');
process.env.SITE_URL = 'https://example.test';
const TOTP_SECRET = base32Encode(crypto.randomBytes(20));
process.env.ADMIN_TOTP_SECRET = TOTP_SECRET;
process.env.ADMIN_PASSWORD_HASH = hashPassword('correct-horse-battery');
// Turnstile / Resend intentionally unset → skipped in dev.

// ---- test harness ----
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.json = (o) => { res.body = o; return res; };
  res.send = (s) => { res.body = s; return res; };
  res.end = (s) => { if (s !== undefined) res.body = s; return res; };
  return res;
}
function req({ method = 'GET', query = {}, body = null, cookies = {} } = {}) {
  return {
    method, query, body, cookies,
    headers: { host: 'example.test', 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
  };
}
async function call(handler, opts) {
  const res = mockRes();
  await handler(req(opts), res);
  return res;
}
function totpNow(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// ---- go ----
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await createClient({ url: process.env.TURSO_DATABASE_URL }).executeMultiple(schema);

const wall = (await import('../api/wall.js')).default;
const notes = (await import('../api/notes.js')).default;
const plus = (await import('../api/plus.js')).default;
const remove = (await import('../api/remove.js')).default;
const admin = (await import('../api/admin.js')).default;

console.log('\ncrypto primitives');
ok('email encrypt/decrypt roundtrip', decryptEmail(encryptEmail('a@b.com')) === 'a@b.com');
ok('token sign/verify roundtrip', verifyToken(signToken('abc123')) === 'abc123');
ok('token rejects tamper', verifyToken(signToken('abc123') + 'x') === null);
ok('password verify (correct)', verifyPassword('correct-horse-battery') === true);
ok('password verify (wrong)', verifyPassword('nope') === false);
ok('TOTP verifies current code', verifyTOTP(totpNow(TOTP_SECRET)) === true);
const badTotp = totpNow(TOTP_SECRET) === '000000' ? '000001' : '000000';
ok('TOTP rejects bad code', verifyTOTP(badTotp) === false);
ok('session create/verify', verifySession(createSession()) === true);

console.log('\nmoderation');
ok('clean note passes', moderate('I want to retire before the bots do').ok === true);
ok('blocks email in text', moderate('reach me at me@x.com').ok === false);
ok('blocks phone in text', moderate('call me 415-555-2671').ok === false);
ok('blocks Luhn-valid card', moderate('my card 4111 1111 1111 1111').ok === false);
ok('does not block ordinary numbers', moderate('40 years, 401k, room 237').ok === true);

console.log('\npublic API');
let r = await call(wall);
ok('wall configured, empty', r.body.configured === true && r.body.wall.length === 0);

r = await call(notes, { method: 'POST', body: { text: 'email me at a@b.com please', elapsedMs: 5000 } });
ok('post rejects PII with 422', r.statusCode === 422 && !!r.body.reason);

r = await call(notes, { method: 'POST', body: { text: 'check out spamsite.com now', elapsedMs: 5000 } });
ok('post rejects URLs with 422', r.statusCode === 422 && !!r.body.reason);

r = await call(notes, { method: 'POST', body: { text: 'bot was here', elapsedMs: 5000, website: 'http://spam.example' } });
ok('honeypot returns fake success', r.statusCode === 200 && r.body.id === 'ok');

r = await call(notes, { method: 'POST', body: { text: 'instant robo-post', elapsedMs: 120 } });
ok('too-fast submit goes pending', r.statusCode === 200 && r.body.pending === true);

r = await call(notes, { method: 'POST', body: { text: 'ship one last thing', author: 'MM', email: 'me@x.com', elapsedMs: 5000 } });
const idA = r.body.id;
const tokenA = new URL(r.body.removalUrl).searchParams.get('token');
ok('note A created', r.statusCode === 200 && !!idA && !!r.body.removalUrl);

r = await call(notes, { method: 'POST', body: { text: 'ship one last thing', elapsedMs: 5000 } });
ok('exact duplicate rejected with 409', r.statusCode === 409 && !!r.body.reason);

r = await call(notes, { method: 'POST', body: { text: 'retire before the bots do', author: null, elapsedMs: 5000 } });
const idB = r.body.id;
ok('note B created (anon, no email)', r.statusCode === 200 && !!idB);

r = await call(plus, { method: 'POST', body: { id: idA } });
ok('plus increments to 1', r.body.plus === 1);

r = await call(wall);
ok('wall now has 2 notes', r.body.wall.length === 2 && r.body.total === 2);
ok('widgets populated', r.body.widgets.trending.length >= 1 && r.body.widgets.recent.length === 2);
ok('wall never leaks email', JSON.stringify(r.body).indexOf('me@x.com') === -1);

r = await call(remove, { method: 'GET', query: { token: tokenA } });
ok('remove GET shows confirm page', typeof r.body === 'string' && r.body.includes('Remove your note'));
r = await call(remove, { method: 'POST', body: { token: tokenA } });
ok('remove POST removes note', typeof r.body === 'string' && r.body.includes('has been removed'));
r = await call(wall);
ok('wall drops removed note', r.body.total === 1);

r = await call(remove, { method: 'GET', query: { token: 'garbage.token' } });
ok('remove rejects bad token', r.statusCode === 400);

console.log('\nadmin');
r = await call(admin, { method: 'POST', query: { action: 'login' }, body: { password: 'wrong', totp: totpNow(TOTP_SECRET) } });
ok('login rejects wrong password', r.statusCode === 401);
r = await call(admin, { method: 'POST', query: { action: 'login' }, body: { password: 'correct-horse-battery', totp: '000000' } });
ok('login rejects wrong TOTP', r.statusCode === 401);

r = await call(admin, { method: 'POST', query: { action: 'login' }, body: { password: 'correct-horse-battery', totp: totpNow(TOTP_SECRET) } });
const setCookie = String(r.getHeader('Set-Cookie') || '');
const session = (setCookie.match(/admin_session=([^;]+)/) || [])[1];
ok('login succeeds, sets session', r.statusCode === 200 && !!session);
const auth = { admin_session: session };

r = await call(admin, { method: 'GET', query: { action: 'stats' }, cookies: auth });
ok('stats reachable when authed', r.statusCode === 200 && typeof r.body.total === 'number');

r = await call(admin, { method: 'GET', query: { action: 'stats' } });
ok('stats blocked when not authed', r.statusCode === 401);

r = await call(admin, { method: 'GET', query: { action: 'list' }, cookies: auth });
ok('list returns notes', Array.isArray(r.body.notes) && r.body.notes.length >= 1);
const visibleNote = r.body.notes.find((n) => n.status === 'visible');

r = await call(admin, { method: 'POST', query: { action: 'act' }, body: { id: visibleNote.id, op: 'hide' }, cookies: auth });
ok('hide action ok', r.body.ok === true);
r = await call(admin, { method: 'GET', query: { action: 'list', status: 'hidden' }, cookies: auth });
ok('note now hidden', r.body.notes.some((n) => n.id === visibleNote.id));

r = await call(admin, { method: 'GET', query: { action: 'export', format: 'csv' }, cookies: auth });
ok('CSV export returns text', typeof r.body === 'string' && r.body.split('\r\n')[0].includes('text'));
r = await call(admin, { method: 'GET', query: { action: 'export', format: 'json', includeEmail: '1' }, cookies: auth });
ok('JSON export w/ email decrypts', r.body.includes('"count"'));

console.log(`\n${failed === 0 ? '✓ all green' : '✗ FAILURES'} — ${passed} passed, ${failed} failed\n`);
await unlink(dbPath).catch(() => {});
process.exit(failed === 0 ? 0 : 1);
