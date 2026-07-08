// GET /api/wall — the single cached read the whole front page uses.
// CDN-cached for 5 min (stale-while-revalidate 10 min) so viral traffic
// costs a near-constant handful of DB reads per day.

import { buildWallPayload } from '../lib/notes.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method-not-allowed' });

  const config = { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null };

  try {
    const payload = await buildWallPayload();
    if (!payload) {
      // DB not configured yet — client falls back to bundled notes.
      return res.status(200).json({ configured: false, config, wall: [], widgets: null });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ configured: true, config, ...payload });
  } catch {
    // Never fail the page: report unconfigured so the client uses its fallback.
    return res.status(200).json({ configured: false, config, wall: [], widgets: null });
  }
}
