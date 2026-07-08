// /api/admin?action=... — one function for the whole admin surface.
// login/logout are public; everything else requires a valid session cookie.
//
//   login          POST  { password, totp }         -> sets admin_session cookie
//   logout         POST                             -> clears cookie
//   list           GET   ?q=&status=&page=          -> notes table (incl. has_email)
//   act            POST  { id, op }                 -> hide | show | delete
//   stats          GET                              -> counts
//   export         GET   ?format=json|csv|txt&includeEmail=1
//   feedback       GET                              -> feedback inbox
//   feedback-act   POST  { id, op }                 -> read | archive | delete

import { db } from '../lib/db.js';
import {
  verifyPassword, verifyTOTP, createSession, verifySession, decryptEmail,
} from '../lib/crypto.js';
import { rateLimit, hashIp } from '../lib/ratelimit.js';
import {
  getBody, getQuery, getCookies, clientIp, setCookie,
} from '../lib/http.js';

const SESSION_COOKIE = 'admin_session';

export default async function handler(req, res) {
  const action = getQuery(req).action || '';

  if (action === 'login') return login(req, res);
  if (action === 'logout') return logout(req, res);

  // Everything below is gated.
  if (!verifySession(getCookies(req)[SESSION_COOKIE])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  switch (action) {
    case 'list': return list(req, res);
    case 'act': return act(req, res);
    case 'stats': return stats(req, res);
    case 'export': return exportData(req, res);
    case 'feedback': return feedbackList(req, res);
    case 'feedback-act': return feedbackAct(req, res);
    default: return res.status(404).json({ error: 'unknown-action' });
  }
}

async function login(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  // Brute-force guard, independent of the DB (fails open only if no DB).
  const rl = await rateLimit(`admin-login:${hashIp(clientIp(req))}`, 5, 900); // 5 / 15 min
  if (!rl.ok) return res.status(429).json({ error: 'too-many-attempts' });

  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
    return res.status(503).json({ error: 'admin-not-configured' });
  }

  const body = await getBody(req);
  const passOk = verifyPassword(body.password);
  // If a TOTP secret is set, require it; otherwise password alone (not advised).
  const totpOk = process.env.ADMIN_TOTP_SECRET ? verifyTOTP(body.totp) : true;

  if (!passOk || !totpOk) return res.status(401).json({ error: 'invalid-credentials' });

  const session = createSession();
  setCookie(res, SESSION_COOKIE, session, { maxAge: 12 * 3600 });
  return res.status(200).json({ ok: true });
}

function logout(req, res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
  return res.status(200).json({ ok: true });
}

async function list(req, res) {
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  const { q = '', status = '', page = '0' } = getQuery(req);
  const limit = 50;
  const offset = Math.max(0, parseInt(page, 10) || 0) * limit;

  const where = [];
  const args = [];
  if (status && ['visible', 'hidden', 'removed'].includes(status)) {
    where.push('status = ?');
    args.push(status);
  }
  if (q) {
    where.push('(text LIKE ? OR author LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const rows = await client.execute({
      sql:
        `SELECT id, text, author, created_at, plus_total, status, ` +
        `CASE WHEN email_enc IS NOT NULL THEN 1 ELSE 0 END AS has_email ` +
        `FROM notes ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    });
    const total = await client.execute({ sql: `SELECT COUNT(*) AS n FROM notes ${clause}`, args });
    return res.status(200).json({
      notes: rows.rows.map((r) => ({
        id: r.id,
        text: r.text,
        author: r.author,
        created_at: Number(r.created_at),
        plus: Number(r.plus_total),
        status: r.status,
        hasEmail: !!Number(r.has_email),
      })),
      total: Number(total.rows[0].n),
      page: Math.max(0, parseInt(page, 10) || 0),
      pageSize: limit,
    });
  } catch {
    return res.status(500).json({ error: 'query-failed' });
  }
}

async function act(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  const { id, op } = await getBody(req);
  if (!id) return res.status(400).json({ error: 'missing-id' });

  try {
    if (op === 'hide') {
      await client.execute({ sql: "UPDATE notes SET status='hidden' WHERE id=?", args: [id] });
    } else if (op === 'show') {
      await client.execute({ sql: "UPDATE notes SET status='visible' WHERE id=?", args: [id] });
    } else if (op === 'delete') {
      // Hard delete of content for GDPR; keep the row id as a tombstone.
      await client.execute({
        sql: "UPDATE notes SET status='removed', text='[removed]', author=NULL, email_enc=NULL WHERE id=?",
        args: [id],
      });
    } else {
      return res.status(400).json({ error: 'bad-op' });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'update-failed' });
  }
}

async function stats(req, res) {
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  try {
    const r = await client.execute({
      sql:
        `SELECT ` +
        `(SELECT COUNT(*) FROM notes) AS total, ` +
        `(SELECT COUNT(*) FROM notes WHERE status='visible') AS visible, ` +
        `(SELECT COUNT(*) FROM notes WHERE status='hidden') AS hidden, ` +
        `(SELECT COUNT(*) FROM notes WHERE status='removed') AS removed, ` +
        `(SELECT COUNT(*) FROM notes WHERE created_at >= ?) AS today, ` +
        `(SELECT COALESCE(SUM(plus_total),0) FROM notes) AS plus_sum, ` +
        `(SELECT COUNT(*) FROM feedback WHERE status='new') AS feedback_new`,
      args: [dayAgo],
    });
    const row = r.rows[0];
    return res.status(200).json({
      total: Number(row.total),
      visible: Number(row.visible),
      hidden: Number(row.hidden),
      removed: Number(row.removed),
      today: Number(row.today),
      plusSum: Number(row.plus_sum),
      feedbackNew: Number(row.feedback_new),
    });
  } catch {
    return res.status(500).json({ error: 'query-failed' });
  }
}

async function exportData(req, res) {
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  const { format = 'json', includeEmail = '' } = getQuery(req);
  const withEmail = includeEmail === '1';

  let rows;
  try {
    rows = (await client.execute(
      'SELECT id, text, author, email_enc, created_at, plus_total, plus_recent, status FROM notes ORDER BY created_at DESC'
    )).rows;
  } catch {
    return res.status(500).json({ error: 'query-failed' });
  }

  const records = rows.map((r) => {
    const rec = {
      id: r.id,
      text: r.text,
      author: r.author,
      created_at: Number(r.created_at),
      created_iso: new Date(Number(r.created_at) * 1000).toISOString(),
      plus_total: Number(r.plus_total),
      status: r.status,
      has_email: r.email_enc != null,
    };
    if (withEmail) rec.email = r.email_enc ? decryptEmail(r.email_enc) : null;
    return rec;
  });

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const cols = ['id', 'created_iso', 'status', 'plus_total', 'author', 'text', 'has_email', ...(withEmail ? ['email'] : [])];
    const csv = [cols.join(',')]
      .concat(records.map((rec) => cols.map((c) => csvCell(rec[c])).join(',')))
      .join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notes-${stamp}.csv"`);
    return res.status(200).send(csv);
  }

  if (format === 'txt') {
    const txt = records
      .map((rec) => `Before AI steals my job… ${rec.text}\n  — ${rec.author || 'Anonymous'} · ${rec.created_iso} · +${rec.plus_total} · ${rec.status}`)
      .join('\n\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notes-${stamp}.txt"`);
    return res.status(200).send(txt);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="notes-${stamp}.json"`);
  return res.status(200).send(JSON.stringify({ exported_at: new Date().toISOString(), count: records.length, notes: records }, null, 2));
}

async function feedbackList(req, res) {
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  try {
    const r = await client.execute(
      "SELECT id, text, email, created_at, status FROM feedback WHERE status != 'archived' ORDER BY created_at DESC LIMIT 200"
    );
    return res.status(200).json({
      feedback: r.rows.map((f) => ({
        id: f.id,
        text: f.text,
        email: f.email,
        created_at: Number(f.created_at),
        status: f.status,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'query-failed' });
  }
}

async function feedbackAct(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  const client = db();
  if (!client) return res.status(503).json({ error: 'not-configured' });
  const { id, op } = await getBody(req);
  if (!id) return res.status(400).json({ error: 'missing-id' });
  const map = { read: "status='read'", archive: "status='archived'" };
  try {
    if (op === 'delete') {
      await client.execute({ sql: 'DELETE FROM feedback WHERE id=?', args: [id] });
    } else if (map[op]) {
      await client.execute({ sql: `UPDATE feedback SET ${map[op]} WHERE id=?`, args: [id] });
    } else {
      return res.status(400).json({ error: 'bad-op' });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'update-failed' });
  }
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
