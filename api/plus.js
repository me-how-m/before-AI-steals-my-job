// POST /api/plus { id } — "+ me too". Rate-limited per IP; client also
// dedupes via localStorage. This is a sentiment counter, not a ballot.

import { db } from '../lib/db.js';
import { rateLimit, hashIp } from '../lib/ratelimit.js';
import { getBody, clientIp } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  const body = await getBody(req);
  const id = String(body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'missing-id' });

  const ip = clientIp(req);
  const rl = await rateLimit(`plus:${hashIp(ip)}`, 60, 3600); // 60/hour/IP
  if (!rl.ok) return res.status(429).json({ error: 'rate-limited' });

  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });

  try {
    await client.execute({
      sql: "UPDATE notes SET plus_total = plus_total + 1, plus_recent = plus_recent + 1 WHERE id = ? AND status = 'visible'",
      args: [id],
    });
    const r = await client.execute({ sql: 'SELECT plus_total FROM notes WHERE id = ?', args: [id] });
    return res.status(200).json({ plus: r.rows[0] ? Number(r.rows[0].plus_total) : null });
  } catch {
    return res.status(500).json({ error: 'update-failed' });
  }
}
