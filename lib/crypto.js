// Security primitives, all built on node:crypto — no external dependency.
// Every function fails closed (returns null/false) when its secret is unset,
// so the site degrades gracefully before Phase 0 configures the env vars.

import crypto from 'node:crypto';

// ---- ids ----
export function newId() {
  return crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
}

// ---- email encryption (AES-256-GCM) ------------------------------------
// Stored while a note lives, so the email↔note link survives for GDPR
// data-subject requests. Blob layout: iv(12) | tag(16) | ciphertext.
function encKey() {
  const k = process.env.EMAIL_ENC_KEY;
  if (!k) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(k) ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64');
  return buf.length === 32 ? buf : null;
}

export function encryptEmail(plain) {
  const key = encKey();
  if (!key || !plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptEmail(blob) {
  const key = encKey();
  if (!key || !blob) return null;
  try {
    const raw = Buffer.from(blob, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---- removal tokens (stateless HMAC capability) ------------------------
export function signToken(id) {
  const secret = process.env.HMAC_SECRET;
  if (!secret || !id) return null;
  const mac = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${mac}`;
}

export function verifyToken(token) {
  const secret = process.env.HMAC_SECRET;
  if (!secret || !token) return null;
  const i = String(token).lastIndexOf('.');
  if (i <= 0) return null;
  const id = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', secret).update(id).digest('base64url');
  if (!timingEqual(mac, expected)) return null;
  return id;
}

// ---- admin password (scrypt) -------------------------------------------
// Stored as "saltHex:hashHex" in ADMIN_PASSWORD_HASH.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password) {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored || !password) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---- TOTP 2FA (RFC 6238, SHA-1, 30s, 6 digits) -------------------------
// window=2 → accept codes within ±60s of server time, tolerating phone/clock
// drift (a common cause of "correct code rejected"). Still 2FA-strong.
export function verifyTOTP(token, window = 2) {
  const secret = process.env.ADMIN_TOTP_SECRET;
  if (!secret || !token) return false;
  const key = base32Decode(secret);
  if (!key.length) return false;
  const code = String(token).replace(/\s/g, '').padStart(6, '0');
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (timingEqual(totpAt(key, step + w), code)) return true;
  }
  return false;
}

function totpAt(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// ---- admin session (signed, self-expiring cookie) ----------------------
export function createSession(ttlSeconds = 12 * 3600) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifySession(cookie) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !cookie) return false;
  const i = String(cookie).lastIndexOf('.');
  if (i <= 0) return false;
  const payload = cookie.slice(0, i);
  const mac = cookie.slice(i + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!timingEqual(mac, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

// ---- base32 (for TOTP secrets / otpauth URIs) --------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = '';
  let out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.substr(i, 5), 2)];
  const rem = bits.length % 5;
  if (rem) out += B32[parseInt(bits.substr(bits.length - rem).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  const bytes = [];
  for (const c of clean) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return Buffer.from(bytes);
}

// ---- helpers -----------------------------------------------------------
function timingEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
