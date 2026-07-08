// GET /api/cron/daily — nightly maintenance (Vercel Cron, 03:00 UTC).
// Vercel automatically sends "Authorization: Bearer $CRON_SECRET" when the
// CRON_SECRET env var is set; we reject anything else.
//   1. decay plus_recent by half (rolling "trending" window)
//   2. purge rate-limit rows older than 30 days (data minimization)
//   3. off-box backup: POST a full JSON dump to BACKUP_WEBHOOK_URL (if set)

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
    const backup = await pushBackup(client);
    return res.status(200).json({ ok: true, notes: Number(c.rows[0].n), backup });
  } catch {
    return res.status(500).json({ error: 'cron-failed' });
  }
}

// Sends a full, restorable dump (emails stay encrypted at rest) to an external
// endpoint. Point BACKUP_WEBHOOK_URL at anything that accepts a POST — e.g. a
// Cloudflare Worker that writes the body to R2, an S3-signed upload proxy, etc.
async function pushBackup(client) {
  const url = process.env.BACKUP_WEBHOOK_URL;
  if (!url) return 'skipped';
  try {
    const notes = (await client.execute(
      'SELECT id,text,author,email_enc,created_at,plus_total,plus_recent,status FROM notes ORDER BY created_at DESC'
    )).rows;
    const feedback = (await client.execute(
      'SELECT id,text,email,created_at,status FROM feedback ORDER BY created_at DESC'
    )).rows;
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.BACKUP_WEBHOOK_SECRET) {
      headers.Authorization = `Bearer ${process.env.BACKUP_WEBHOOK_SECRET}`;
    }
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ exported_at_unix: Math.floor(Date.now() / 1000), notes, feedback }),
    });
    return r.ok ? 'sent' : `failed-${r.status}`;
  } catch {
    return 'error';
  }
}
