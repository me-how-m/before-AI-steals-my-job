// GET /api/cron/daily — nightly maintenance (Vercel Cron, 03:00 UTC).
// Vercel automatically sends "Authorization: Bearer $CRON_SECRET" when the
// CRON_SECRET env var is set; we reject anything else.
//  1. decay plus_recent by half (rolling "trending" window)
//  2. purge rate-limit rows older than 30 days (data minimization)

import { db } from '../../lib/db.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const client = db();
  if (!client) return res.status(200).json({ skipped: 'not-configured' });

  try {
    await client.execute('UPDATE notes SET plus_recent = plus_recent * 0.5');
    const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
    await client.execute({ sql: 'DELETE FROM rate_limits WHERE window_start < ?', args: [cutoff] });
    const c = await client.execute('SELECT COUNT(*) AS n FROM notes');
    return res.status(200).json({ ok: true, notes: Number(c.rows[0].n) });
  } catch {
    return res.status(500).json({ error: 'cron-failed' });
  }
}
