// Sliding-window rate limiter backed by the rate_limits table.
// Keys are salted HMACs of the IP — never the raw IP. Fails OPEN on any
// error or when the DB is unconfigured, so it can never take the site down.

import crypto from 'node:crypto';
import { db } from './db.js';

export function hashIp(ip) {
  const salt = process.env.RATE_LIMIT_SALT || 'beforeaistealsmyjob-default-salt';
  return crypto.createHmac('sha256', salt).update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

// max requests per windowSec for a given key. Returns { ok, remaining }.
export async function rateLimit(key, max, windowSec) {
  const client = db();
  if (!client) return { ok: true, remaining: max };
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSec;
  try {
    const r = await client.execute({
      sql: 'SELECT window_start, count FROM rate_limits WHERE key = ?',
      args: [key],
    });
    const row = r.rows[0];
    if (!row || Number(row.window_start) < windowStart) {
      await client.execute({
        sql:
          'INSERT INTO rate_limits(key, window_start, count) VALUES(?, ?, 1) ' +
          'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1',
        args: [key, now],
      });
      return { ok: true, remaining: max - 1 };
    }
    if (Number(row.count) >= max) return { ok: false, remaining: 0 };
    await client.execute({
      sql: 'UPDATE rate_limits SET count = count + 1 WHERE key = ?',
      args: [key],
    });
    return { ok: true, remaining: max - Number(row.count) - 1 };
  } catch {
    return { ok: true, remaining: max }; // fail open
  }
}
