// Shared shapers/queries used by the public API.

import { db } from './db.js';

// Public projection — never leaks email_enc or status to the client.
export function toPublic(row) {
  return {
    id: row.id,
    text: row.text,
    author: row.author || null,
    hours: hoursSince(Number(row.created_at)),
    plus: Number(row.plus_total) || 0,
  };
}

function hoursSince(createdAt) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  return Math.floor(secs / 3600);
}

// Builds the cached wall payload: a sampled pool for the drifting notes plus
// the three widget lists. Four indexed queries, run at most ~once per 5 min
// because /api/wall is CDN-cached.
export async function buildWallPayload() {
  const client = db();
  if (!client) return null;

  const q = (sql, args = []) => client.execute({ sql, args });
  const [recent, top, trending, random, count] = await Promise.all([
    q("SELECT id,text,author,created_at,plus_total FROM notes WHERE status='visible' ORDER BY created_at DESC LIMIT 60"),
    q("SELECT id,text,author,created_at,plus_total FROM notes WHERE status='visible' ORDER BY plus_total DESC LIMIT 60"),
    q("SELECT id,text,author,created_at,plus_total FROM notes WHERE status='visible' ORDER BY plus_recent DESC LIMIT 10"),
    // ORDER BY RANDOM() scans, but it runs only when the CDN cache misses
    // (~288×/day), so it's negligible even at millions of rows.
    q("SELECT id,text,author,created_at,plus_total FROM notes WHERE status='visible' ORDER BY RANDOM() LIMIT 100"),
    q("SELECT COUNT(*) AS n, SUM(CASE WHEN author='200-AI-entries' THEN 1 ELSE 0 END) AS ai FROM notes WHERE status='visible'"),
  ]);

  const pool = new Map();
  for (const row of [...recent.rows, ...top.rows, ...random.rows]) {
    if (!pool.has(row.id)) pool.set(row.id, row);
  }

  return {
    generatedAt: Math.floor(Date.now() / 1000), // for "refreshed Xm ago" in the widget
    total: Number(count.rows[0].n),
    aiTotal: Number(count.rows[0].ai || 0),
    wall: [...pool.values()].slice(0, 200).map(toPublic),
    widgets: {
      trending: trending.rows.map(toPublic),
      top: top.rows.slice(0, 10).map(toPublic),
      recent: recent.rows.slice(0, 10).map(toPublic),
    },
  };
}
