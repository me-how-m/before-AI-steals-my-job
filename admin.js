/* Admin dashboard for Before AI steals my job…
   All calls hit /api/admin?action=… and rely on the HttpOnly session cookie. */

const $ = (id) => document.getElementById(id);

async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/admin?${qs}`, { credentials: 'same-origin' });
  return { ok: res.ok, status: res.status, data: await safeJson(res) };
}
async function apiPost(action, body = {}) {
  const res = await fetch(`/api/admin?action=${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await safeJson(res) };
}
async function safeJson(res) { try { return await res.json(); } catch { return null; } }

const fmtWhen = (secs) => {
  const d = new Date(secs * 1000);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const esc = (s) => String(s == null ? '' : s);

// ---- auth ----
const loginView = $('login-view');
const dashView = $('dash-view');

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-btn').disabled = true;
  $('login-error').hidden = true;
  const res = await apiPost('login', {
    password: $('login-password').value,
    totp: $('login-totp').value.trim(),
  });
  $('login-btn').disabled = false;
  if (res.ok) {
    showDash();
  } else if (res.status === 429) {
    showLoginError('Too many attempts — wait a few minutes.');
  } else if (res.status === 503) {
    showLoginError('Admin is not configured yet (missing env vars).');
  } else {
    showLoginError('Wrong passphrase or code.');
  }
});

function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.hidden = false;
}

$('logout').addEventListener('click', async () => {
  await apiPost('logout');
  dashView.hidden = true;
  loginView.hidden = false;
});

async function showDash() {
  loginView.hidden = true;
  dashView.hidden = false;
  await Promise.all([loadStats(), loadNotes(), loadFeedback()]);
  updateExportLinks();
}

// ---- stats ----
async function loadStats() {
  const res = await apiGet('stats');
  if (!res.ok) return;
  const s = res.data;
  const cards = [
    ['total', s.total], ['visible', s.visible], ['hidden', s.hidden],
    ['removed', s.removed], ['today', s.today], ['+ total', s.plusSum],
    ['new feedback', s.feedbackNew],
  ];
  $('stats').innerHTML = cards
    .map(([label, num]) => `<div class="stat"><div class="stat-num">${Number(num).toLocaleString()}</div><div class="stat-label">${label}</div></div>`)
    .join('');
}

// ---- notes table ----
let page = 0;
let total = 0;
const pageSize = 50;

const search = $('search');
const filterStatus = $('filter-status');
let searchTimer = null;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page = 0; loadNotes(); updateExportLinks(); }, 250);
});
filterStatus.addEventListener('change', () => { page = 0; loadNotes(); updateExportLinks(); });

async function loadNotes() {
  const res = await apiGet('list', { q: search.value.trim(), status: filterStatus.value, page: String(page) });
  if (res.status === 401) { dashView.hidden = true; loginView.hidden = false; return; }
  if (!res.ok) return;
  total = res.data.total;
  renderNotes(res.data.notes);
  renderPager();
}

function renderNotes(notes) {
  const body = $('notes-body');
  if (!notes.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No notes match.</td></tr>';
    return;
  }
  body.innerHTML = '';
  for (const n of notes) {
    const tr = document.createElement('tr');
    tr.appendChild(td(fmtWhen(n.created_at), 'cell-when'));
    tr.appendChild(td(n.text, 'cell-note'));
    tr.appendChild(td(n.author || '—'));
    tr.appendChild(td(`+${Number(n.plus)}`, 'cell-plus'));
    tr.appendChild(td(n.hasEmail ? '✓' : '—'));
    const st = document.createElement('td');
    st.innerHTML = `<span class="badge ${n.status}">${n.status}</span>`;
    tr.appendChild(st);
    tr.appendChild(actionsCell(n));
    body.appendChild(tr);
  }
}

function td(text, cls) {
  const el = document.createElement('td');
  if (cls) el.className = cls;
  el.textContent = text; // textContent — note text is untrusted input
  return el;
}

function actionsCell(n) {
  const cell = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'row-actions';
  if (n.status !== 'removed') {
    if (n.status === 'visible') wrap.appendChild(actionBtn('hide', () => act(n.id, 'hide')));
    else wrap.appendChild(actionBtn('show', () => act(n.id, 'show')));
    wrap.appendChild(actionBtn('delete', () => {
      if (confirm('Permanently delete this note and its email? This is for GDPR erasure and cannot be undone.')) act(n.id, 'delete');
    }, 'btn-danger'));
  }
  cell.appendChild(wrap);
  return cell;
}
function actionBtn(label, onClick, extra = '') {
  const b = document.createElement('button');
  b.className = `btn btn-sm ${extra}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
async function act(id, op) {
  const res = await apiPost('act', { id, op });
  if (res.ok) { loadNotes(); loadStats(); }
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pager = $('pager');
  pager.innerHTML = '';
  const prev = document.createElement('button');
  prev.className = 'btn btn-sm';
  prev.textContent = '← prev';
  prev.disabled = page <= 0;
  prev.addEventListener('click', () => { if (page > 0) { page--; loadNotes(); } });
  const next = document.createElement('button');
  next.className = 'btn btn-sm';
  next.textContent = 'next →';
  next.disabled = page >= pages - 1;
  next.addEventListener('click', () => { if (page < pages - 1) { page++; loadNotes(); } });
  const label = document.createElement('span');
  label.textContent = `page ${page + 1} of ${pages} · ${total.toLocaleString()} notes`;
  pager.append(prev, label, next);
}

// ---- exports ----
function updateExportLinks() {
  const includeEmail = $('export-email').checked ? '&includeEmail=1' : '';
  for (const fmt of ['json', 'csv', 'txt']) {
    $(`export-${fmt}`).href = `/api/admin?action=export&format=${fmt}${includeEmail}`;
    $(`export-${fmt}`).setAttribute('download', '');
  }
}
$('export-email').addEventListener('change', updateExportLinks);

// ---- feedback ----
async function loadFeedback() {
  const res = await apiGet('feedback');
  if (!res.ok) return;
  const list = $('feedback-list');
  const items = res.data.feedback || [];
  if (!items.length) { list.innerHTML = '<div class="empty">No feedback yet.</div>'; return; }
  list.innerHTML = '';
  for (const f of items) {
    const card = document.createElement('div');
    card.className = `fb ${f.status === 'new' ? 'new' : ''}`.trim();
    const text = document.createElement('p');
    text.className = 'fb-text';
    text.textContent = f.text;
    const meta = document.createElement('div');
    meta.className = 'fb-meta';
    const when = document.createElement('span');
    when.textContent = fmtWhen(f.created_at);
    meta.appendChild(when);
    if (f.email) {
      const em = document.createElement('span');
      em.textContent = f.email;
      meta.append(dot(), em);
    }
    const actions = document.createElement('span');
    actions.className = 'fb-actions';
    if (f.status === 'new') actions.appendChild(actionBtn('mark read', () => fbAct(f.id, 'read')));
    actions.appendChild(actionBtn('archive', () => fbAct(f.id, 'archive')));
    actions.appendChild(actionBtn('delete', () => { if (confirm('Delete this feedback?')) fbAct(f.id, 'delete'); }, 'btn-danger'));
    meta.append(dot(), actions);
    card.append(text, meta);
    list.appendChild(card);
  }
}
function dot() { const s = document.createElement('span'); s.className = 'dot'; s.textContent = '·'; return s; }
async function fbAct(id, op) {
  const res = await apiPost('feedback-act', { id, op });
  if (res.ok) { loadFeedback(); loadStats(); }
}

// ---- boot: are we already logged in? ----
(async () => {
  const res = await apiGet('stats');
  if (res.ok) showDash();
})();
