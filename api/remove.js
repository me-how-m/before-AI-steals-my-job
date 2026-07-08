// /api/remove — self-service note removal via a signed capability token.
// GET renders a confirm page (so link prefetchers can't delete anything);
// POST performs the removal. The token itself is the proof of ownership.

import { db } from '../lib/db.js';
import { verifyToken } from '../lib/crypto.js';
import { getBody, getQuery, escapeHtml } from '../lib/http.js';

export default async function handler(req, res) {
  const token =
    req.method === 'GET' ? getQuery(req).token : (await getBody(req)).token;
  const id = verifyToken(token);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id) {
    res.statusCode = 400;
    return res.end(page('Invalid or expired link', 'This removal link is not valid. If your note is still up and you want it gone, use the Contact link on the site.'));
  }

  if (req.method === 'GET') {
    return res.end(confirmPage(token));
  }

  if (req.method === 'POST') {
    const client = db();
    if (!client) {
      res.statusCode = 503;
      return res.end(page('Not available yet', 'The wall is not fully set up. Try again shortly.'));
    }
    try {
      await client.execute({
        sql: "UPDATE notes SET status = 'removed', text = '[removed]', author = NULL, email_enc = NULL WHERE id = ?",
        args: [id],
      });
    } catch {
      res.statusCode = 500;
      return res.end(page('Something went wrong', 'Please try again, or use the Contact link on the site.'));
    }
    return res.end(page('Your note has been removed', 'It may take a few minutes to disappear from the wall while the cache refreshes.'));
  }

  res.statusCode = 405;
  return res.end(page('Method not allowed', ''));
}

function shell(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Before AI steals my job… — removal</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#ffd9b8,#f4d4ff);font-family:system-ui,-apple-system,sans-serif;color:#1f1a17;padding:24px}
  .card{background:#fdf6ee;border-radius:22px;padding:32px;max-width:440px;width:100%;
    box-shadow:0 40px 80px -20px rgba(0,0,0,.35);text-align:center}
  h1{font-size:22px;margin:0 0 10px}
  p{font-size:14px;line-height:1.55;color:#3a322d;margin:0 0 20px}
  .quote{font-style:italic;background:rgba(255,173,122,.18);border:1px dashed rgba(255,106,61,.4);
    border-radius:14px;padding:12px 14px;margin:0 0 20px;font-size:15px}
  button{font:inherit;font-size:14px;font-weight:600;border:0;border-radius:999px;padding:12px 22px;cursor:pointer}
  .danger{background:#1f1a17;color:#fdf6ee}
  a{color:#3a322d}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

function page(title, body) {
  return shell(`<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p><a href="/">← back to the wall</a></p>`);
}

function confirmPage(token) {
  const safe = escapeHtml(token);
  return shell(
    `<h1>Remove your note?</h1>
     <p>This permanently deletes your note from the wall. This can't be undone.</p>
     <form method="POST" action="/api/remove">
       <input type="hidden" name="token" value="${safe}"/>
       <button class="danger" type="submit">Yes, remove my note</button>
     </form>
     <p style="margin-top:18px"><a href="/">Cancel — keep it up</a></p>`
  );
}
