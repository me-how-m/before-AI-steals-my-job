// POST /api/feedback — messages/requests from the bottom-right widget.
// Turnstile + rate limited. Surfaced in the admin inbox.

import { db } from '../lib/db.js';
import { newId } from '../lib/crypto.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { rateLimit, hashIp } from '../lib/ratelimit.js';
import { getBody, clientIp } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  const body = await getBody(req);
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  if (text.length > 1000) return res.status(400).json({ error: 'too-long' });

  // Honeypot — bots that fill the hidden field get a quiet fake success.
  if (String(body.website || '').trim()) return res.status(200).json({ ok: true });

  const ip = clientIp(req);
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return res.status(403).json({ error: 'verification-failed' });
  }
  const rl = await rateLimit(`feedback:${hashIp(ip)}`, 5, 3600);
  if (!rl.ok) return res.status(429).json({ error: 'rate-limited' });

  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured', local: true });

  const email = String(body.email || '').trim().slice(0, 200) || null;
  try {
    await client.execute({
      sql: 'INSERT INTO feedback(id, text, email, created_at, status) VALUES(?, ?, ?, ?, ?)',
      args: [newId(), text, email, Math.floor(Date.now() / 1000), 'new'],
    });
  } catch {
    return res.status(500).json({ error: 'write-failed' });
  }
  return res.status(200).json({ ok: true });
}
