// Small request/response helpers. Vercel's Node runtime already provides
// req.body / req.query / req.cookies and res.status().json(), but we add
// stream fallbacks so the same code works under plain Node (local tests).

export async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const ctype = req.headers?.['content-type'] || '';
  if (typeof req.body === 'string') return parseBody(req.body, ctype);
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => resolve(parseBody(data, ctype)));
    req.on('error', () => resolve({}));
  });
}

function parseBody(raw, ctype) {
  if (!raw) return {};
  if (ctype.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

export function getQuery(req) {
  if (req.query) return req.query;
  try {
    const u = new URL(req.url, 'http://localhost');
    return Object.fromEntries(u.searchParams);
  } catch {
    return {};
  }
}

export function getCookies(req) {
  if (req.cookies) return req.cookies;
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown').trim();
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers?.host || 'localhost';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Strict'}`);
  if (opts.secure !== false) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookie = parts.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
