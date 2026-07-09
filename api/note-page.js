// GET /n/:id (rewritten here as /api/note-page?id=:id) — a note's permalink.
//
// Serves the normal wall page with three additions baked into the HTML:
//   1. note-specific <title>/OG/Twitter tags → link unfurls show the wish
//   2. a canonical URL for the note
//   3. window.DEEP_NOTE = {…} → the client opens the note instantly, no
//      extra API call
//
// Caching (the whole point): the response is CDN-cached for 1h with a day of
// stale-while-revalidate, and the page shell is itself fetched from the CDN —
// so a viral link costs ~1 origin hit per hour, not per visitor. Unknown,
// hidden, or removed notes 302 to the wall (also briefly cached).

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db.js';
import { getQuery, escapeHtml } from '../lib/http.js';

const CANONICAL_HOST = 'https://beforeaistealsmyjob.space';

// The page shell is bundled with the function (vercel.json includeFiles) and
// read from disk — no network dependency. The old self-fetch could fail
// transiently, and that failure used to get CACHED as a redirect for 5 min,
// which is exactly how a healthy permalink "didn't work" for a user. A fetch
// fallback remains for exotic runtimes; failures are never cached now.
let shellMemo = null;
function shellFromDisk() {
  if (shellMemo) return shellMemo;
  try {
    shellMemo = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    return shellMemo;
  } catch {
    return null;
  }
}
async function shellFromCdn(req) {
  try {
    const base = process.env.SITE_URL || `https://${req.headers.host}`;
    const r = await fetch(`${base}/index.html`);
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const id = String(getQuery(req).id || '').trim();
  const client = db();
  if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || !client) return redirectHome(res);

  let row;
  try {
    const r = await client.execute({
      sql: "SELECT id, text, author, created_at, plus_total FROM notes WHERE id = ? AND status = 'visible' LIMIT 1",
      args: [id],
    });
    row = r.rows[0];
  } catch {
    return redirectHome(res);
  }
  if (!row) return redirectHome(res);

  // The static shell: bundled file first, CDN fetch as a fallback.
  let html = shellFromDisk() || (await shellFromCdn(req));
  if (!html) return redirectHome(res);

  const note = {
    id: row.id,
    text: row.text,
    author: row.author || null,
    createdAt: Number(row.created_at),
    hours: Math.max(0, Math.floor((Date.now() / 1000 - Number(row.created_at)) / 3600)),
    plus: Number(row.plus_total) || 0,
  };
  const author = note.author === '200-AI-entries' ? 'AI' : (note.author || 'Anonymous');
  const title = escapeHtml(`“${note.text}” — ${author}`);
  const desc = escapeHtml('A wish on the wall of things people (and AI) want to do before AI steals their job. Read it, +1 it, or leave your own.');
  const url = `${CANONICAL_HOST}/n/${note.id}`;

  // All replacements use function form so note text containing $-patterns
  // can't corrupt the output. The note ships as an INERT JSON data block
  // (type="application/json") — the CSP forbids inline executable scripts
  // (script-src 'self'), which is exactly why an inline window.DEEP_NOTE
  // assignment silently never ran in production. Data blocks aren't executed,
  // so CSP doesn't apply; app.js parses it. "<" is escaped so "</script>" in
  // a note can never terminate the element.
  const bootstrap = `<script id="deep-note" type="application/json">${JSON.stringify(note).replace(/</g, '\\u003c')}</script>`;
  html = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => a + url + b)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, (_, a, b) => a + title + b)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, (_, a, b) => a + desc + b)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, (_, a, b) => a + url + b)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, (_, a, b) => a + title + b)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, (_, a, b) => a + desc + b)
    .replace('</head>', () => `${bootstrap}\n</head>`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(html);
}

function redirectHome(res) {
  res.statusCode = 302;
  res.setHeader('Location', '/');
  // Never cache: a redirect can be a transient failure (DB hiccup), and a
  // cached one turns a 1-second blip into 5 minutes of "the link is broken".
  res.setHeader('Cache-Control', 'no-store');
  return res.end();
}
