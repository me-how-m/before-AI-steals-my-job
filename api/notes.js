// POST /api/notes — create a note.
// Turnstile + per-IP + global rate limits. Email (if given) is encrypted at
// rest. Returns a signed removal URL; also emails it when an address was left.

import { db } from '../lib/db.js';
import { encryptEmail, signToken, newId } from '../lib/crypto.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { rateLimit, hashIp } from '../lib/ratelimit.js';
import { getBody, clientIp, siteUrl } from '../lib/http.js';
import { sendRemovalEmail } from '../lib/email.js';
import { moderate } from '../lib/moderation.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  const body = await getBody(req);
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  if (text.length > 240) return res.status(400).json({ error: 'too-long' });

  // Honeypot: the hidden "website" field is invisible to humans. If a bot
  // filled it, pretend everything worked and store nothing.
  if (String(body.website || '').trim()) {
    return res.status(200).json({ id: 'ok', removalUrl: null, emailed: false, pending: false });
  }

  // Reject PII / links / blocklisted content before anything else touches it.
  const mod = moderate(text);
  if (!mod.ok) return res.status(422).json({ error: 'blocked', reason: mod.reason });
  const authorMod = moderate(String(body.author || ''));
  if (!authorMod.ok) return res.status(422).json({ error: 'blocked', reason: 'The signature can’t contain personal info or links.' });

  const ip = clientIp(req);

  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return res.status(403).json({ error: 'verification-failed' });
  }

  const perIp = await rateLimit(`post:${hashIp(ip)}`, 5, 3600); // 5/hour/IP
  if (!perIp.ok) return res.status(429).json({ error: 'rate-limited' });
  const global = await rateLimit('post:global', 500, 3600); // 500/hour site-wide
  if (!global.ok) return res.status(429).json({ error: 'busy' });

  const client = db();
  if (!client) {
    // No DB yet: tell the client to keep the note locally (optimistic).
    return res.status(503).json({ error: 'not-configured', local: true });
  }

  // Duplicate throttle: the exact same words already on the wall → nudge to +1 instead.
  try {
    const dup = await client.execute({
      sql: "SELECT id FROM notes WHERE status != 'removed' AND lower(trim(text)) = ? LIMIT 1",
      args: [text.toLowerCase()],
    });
    if (dup.rows.length) {
      return res.status(409).json({ error: 'duplicate', reason: 'Someone already left exactly these words — open it and “+ me too” instead.' });
    }
  } catch { /* non-fatal; worst case a duplicate slips through */ }

  const id = newId();
  const author = String(body.author || '').trim().slice(0, 32) || null;
  const email = String(body.email || '').trim().slice(0, 200) || null;
  const emailEnc = email ? encryptEmail(email) : null;
  const now = Math.floor(Date.now() / 1000);

  // Time-to-submit trap: the UI reports ms between first keystroke and posting.
  // Instant (or absent, i.e. direct API) submissions smell scripted — don't
  // reject, just hold them hidden for review.
  const elapsed = Number(body.elapsedMs);
  const suspicious = !Number.isFinite(elapsed) || elapsed < 2500;
  const pending = process.env.MODERATION_MODE === 'pending' || suspicious;

  try {
    await client.execute({
      sql:
        'INSERT INTO notes(id, text, author, email_enc, created_at, plus_total, plus_recent, status) ' +
        'VALUES(?, ?, ?, ?, ?, 0, 0, ?)',
      args: [id, text, author, emailEnc, now, pending ? 'hidden' : 'visible'],
    });
  } catch {
    return res.status(500).json({ error: 'write-failed' });
  }

  const token = signToken(id);
  const removalUrl = token ? `${siteUrl(req)}/api/remove?token=${encodeURIComponent(token)}` : null;

  let emailed = false;
  if (email && removalUrl) {
    const r = await sendRemovalEmail(email, text, removalUrl);
    emailed = r.sent;
  }

  return res.status(200).json({ id, removalUrl, emailed, pending });
}
