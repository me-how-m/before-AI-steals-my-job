/* Before AI steals my job… — front-end.
   Talks to /api/* when the backend is configured; falls back to the bundled
   notes (data.js) so the page is never blank or broken. */

// ---- config ----
const PROMPT = 'Before AI steals my job…';
const BASE_COUNT = 124583;

// Floater geometry + row layout adapt to the viewport: on phones the notes are
// narrower and there are fewer, tighter rows so the drift + center-fade still read.
function layout() {
  // Mobile: wider, taller boxes (2 lines of text), fewer rows, more breathing room.
  if (window.innerWidth <= 600) return { W: 210, GAP: 20, H: 60, rows: 7, stride: 60 + 18, trunc: 48 };
  return { W: 260, GAP: 24, H: 44, rows: 10, stride: 44 + 24, trunc: 30 };
}
let L = layout();

// ---- helpers ----
const formatPlus = (n) => {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return String(n);
};

const formatTime = (hoursAgo) => {
  const d = new Date(Date.now() - hoursAgo * 3600 * 1000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (hoursAgo < 24) return `today, ${time}`;
  if (hoursAgo < 48) return `yesterday, ${time}`;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
};

const formatTimeShort = (h) => (h < 1 ? 'now' : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`);
const truncate = (s, n = 30) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
// AI-seeded notes are stored as author '200-AI-entries'; show a clean byline.
const displayAuthor = (a) => (a === '200-AI-entries' ? 'AI' : (a || 'Anonymous'));
const noteUrl = (id) => `https://beforeaistealsmyjob.space/n/${id}`;
const formatDate = (secs) =>
  new Date(secs * 1000).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const $ = (id) => document.getElementById(id);

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data };
  } catch (_) {
    return { ok: false, status: 0, data: null };
  }
}

// ---- state ----
let wallNotes = FALLBACK_NOTES.slice(); // working set for the drifting wall
let widgetNotes = [];                   // notes referenced by the widget lists
let userNotes = [];                     // notes this visitor just posted
let wallConfig = null;                  // { turnstileSiteKey }
let serverTotal = null;                 // visible count from the server
let serverAi = 0;                       // how many of those are AI-authored
let openNoteId = null;
const plusMap = {};
let draftText = '';
let signMode = null;   // 'sign' | 'anon' | null
let emailMode = null;  // 'leave' | 'skip' | null
let copyTimer = null;
let toastTimer = null;

const noteById = (id) =>
  userNotes.find((n) => n.id === id) ||
  wallNotes.find((n) => n.id === id) ||
  widgetNotes.find((n) => n.id === id) ||
  null;

// ---- floating notes ----
const floatersEl = $('floaters');
let floaterEls = [];

function buildFloaters() {
  floatersEl.textContent = '';
  floaterEls = [];
  const vw = window.innerWidth;
  // The drift keyframes move `left` from -10% to 110% of the viewport, so the
  // real travel per animation cycle is 1.2 * vw. The slot math MUST use that
  // same distance — using vw + W (as before) understates spacing on narrow
  // screens and adjacent boxes overlap. On desktop the two are ~equal, which
  // is why the bug only showed on mobile.
  const cycle = vw * 1.2;
  const slot = L.W + L.GAP;
  const notesPerRow = Math.max(1, Math.floor(cycle / slot));
  ROWS.forEach((row) => {
    const stepDelay = (slot / cycle) * row.speed;
    for (let i = 0; i < notesPerRow; i++) {
      const note = noteById(row.notes[i % row.notes.length]);
      if (!note) continue;
      const btn = document.createElement('button');
      btn.className = 'floater' + (openNoteId === note.id ? ' is-hidden' : '');
      btn.dataset.noteId = note.id;
      btn.style.top = `calc(50% + ${row.dyPx}px)`;
      btn.style.width = `${L.W}px`;
      btn.style.height = `${L.H}px`;
      btn.style.animationName = row.dir > 0 ? 'driftRight' : 'driftLeft';
      btn.style.animationDuration = `${row.speed}s`;
      btn.style.animationDelay = `${-(i * stepDelay)}s`;
      btn.style.opacity = '0';
      const span = document.createElement('span');
      span.className = 'floater-text';
      span.textContent = truncate(note.text, L.trunc);
      btn.appendChild(span);
      btn.addEventListener('click', () => openNote(note.id));
      floatersEl.appendChild(btn);
      floaterEls.push(btn);
    }
  });
}

// Recompute the responsive layout and rebuild the wall (used at init + on resize,
// since crossing the mobile breakpoint changes row count and floater size).
function rebuild() {
  L = layout();
  ROWS = buildRows(wallNotes, L.rows, L.stride);
  buildFloaters();
}

// Desktop: fade toward the horizontal center (the original center-glow look —
// works because many boxes share the width). Mobile: that curve leaves only
// the central box visible, so instead boxes stay readable across the whole
// width and fade only within ~110px of the physical screen edges.
function opacityLoop() {
  const vw = window.innerWidth;
  const mobile = vw <= 600;
  const cx = vw / 2;
  const maxDist = Math.max(vw * 0.42, 1);
  for (const el of floaterEls) {
    const rect = el.getBoundingClientRect();
    let o;
    if (mobile) {
      const fade = 110; // px of fade at each screen edge
      o = 0.92 * Math.max(0, Math.min(1, rect.right / fade, (vw - rect.left) / fade));
    } else {
      const dist = Math.abs(rect.left + rect.width / 2 - cx);
      let t = Math.max(0, Math.min(1, 1 - dist / maxDist));
      o = Math.pow(t, 1.5) * 0.85;
    }
    el.style.opacity = String(o);
  }
  requestAnimationFrame(opacityLoop);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuild, 150);
});

// On mobile the brand badge shows a short label; tap it to reveal the full line.
const brandEl = document.querySelector('.brand');
brandEl.addEventListener('click', () => brandEl.classList.toggle('brand--expanded'));

// ---- brand counter ----
function renderCount() {
  if (serverTotal != null) {
    const ai = serverAi || 0;
    const human = Math.max(0, serverTotal - ai);
    $('brand-count').textContent = human.toLocaleString();
    const thing = human === 1 ? 'thing' : 'things';
    const aiBit = ai ? ` (+ ${ai.toLocaleString()} ${ai === 1 ? 'AI' : 'AIs'})` : '';
    $('brand-text-full').textContent = ` ${thing} people${aiBit} want to do before AI steals their job`;
    $('brand-text-short').textContent = ai ? ` (+ ${ai.toLocaleString()} AIs)` : ' wishes';
  } else {
    // Offline fallback (API/DB unreachable): keep it simple.
    $('brand-count').textContent = (BASE_COUNT + userNotes.length).toLocaleString();
  }
}

// ---- toast ----
function showToast(msg, ms = 3200) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

// ---- Turnstile ----
const tsTokens = { sign: null, feedback: null };
const tsWidgets = {};
const turnstileRequired = () => !!(wallConfig && wallConfig.turnstileSiteKey);

function mountTurnstile(el, name) {
  if (!turnstileRequired() || !el) return;
  if (tsWidgets[name] != null) { // already rendered — get a fresh token
    try { window.turnstile.reset(tsWidgets[name]); } catch (_) {}
    tsTokens[name] = null;
    return;
  }
  let tries = 0;
  const go = () => {
    if (window.turnstile && el.isConnected) {
      tsWidgets[name] = window.turnstile.render(el, {
        sitekey: wallConfig.turnstileSiteKey,
        callback: (t) => { tsTokens[name] = t; onTsChange(name); },
        'expired-callback': () => { tsTokens[name] = null; onTsChange(name); },
        'error-callback': () => { tsTokens[name] = null; onTsChange(name); },
      });
    } else if (tries++ < 25) {
      setTimeout(go, 150);
    }
  };
  go();
}
function resetTurnstile(name) {
  if (tsWidgets[name] != null) { try { window.turnstile.reset(tsWidgets[name]); } catch (_) {} }
  tsTokens[name] = null;
}
function onTsChange(name) {
  if (name === 'sign') refreshSignStep1();
  if (name === 'feedback') refreshFeedback();
}

// ---- composer ----
const composer = $('composer');
const composerForm = $('composer-form');
const composerHint = $('composer-hint');
const composerInput = $('composer-input');
const composerCount = $('composer-count');
const composerSubmit = $('composer-submit');
const composerToggle = $('composer-toggle');

const COLLAPSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const EXPAND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 3 12 9 18"/><polyline points="15 6 21 12 15 18"/></svg>';

function setCollapsed(collapsed) {
  composer.classList.toggle('is-collapsed', collapsed);
  composerForm.hidden = collapsed;
  composerHint.hidden = !collapsed;
  composerToggle.innerHTML = collapsed ? EXPAND_ICON : COLLAPSE_ICON;
  composerToggle.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
}
composerToggle.addEventListener('click', () => setCollapsed(!composer.classList.contains('is-collapsed')));
composerHint.addEventListener('click', () => setCollapsed(false));

// Time-to-submit trap: remember when the visitor first started typing.
let firstTypedAt = null;

composerInput.addEventListener('input', () => {
  if (firstTypedAt === null && composerInput.value) firstTypedAt = Date.now();
  composerCount.textContent = `${composerInput.value.length}/240`;
  composerSubmit.disabled = !composerInput.value.trim();
});

composerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = composerInput.value.trim();
  if (!v) return;
  draftText = v;
  composerInput.value = '';
  composerCount.textContent = '0/240';
  composerSubmit.disabled = true;
  openSignModal();
});

// ---- sign + email modal ----
const signScrim = $('sign-scrim');
const signName = $('sign-name');
const signEmail = $('sign-email');
const choiceSign = $('choice-sign');
const choiceAnon = $('choice-anon');
const choiceEmail = $('choice-email');
const choiceSkip = $('choice-skip');
const signContinue = $('sign-continue');
const signPost = $('sign-post');

function setSignStep(step) {
  $('sign-step-0').hidden = step !== 0;
  $('sign-step-1').hidden = step !== 1;
  $('pip-1').classList.toggle('on', step >= 1);
  if (step === 1) mountTurnstile($('sign-turnstile'), 'sign');
}

function refreshSignStep0() {
  choiceSign.classList.toggle('is-on', signMode === 'sign');
  choiceAnon.classList.toggle('is-on', signMode === 'anon');
  signName.hidden = signMode !== 'sign';
  signContinue.disabled = signMode === null || (signMode === 'sign' && !signName.value.trim());
}

function refreshSignStep1() {
  choiceEmail.classList.toggle('is-on', emailMode === 'leave');
  choiceSkip.classList.toggle('is-on', emailMode === 'skip');
  signEmail.hidden = emailMode !== 'leave';
  const base = emailMode === null || (emailMode === 'leave' && !signEmail.value.trim());
  signPost.disabled = base || (turnstileRequired() && !tsTokens.sign);
}

function openSignModal() {
  signMode = null;
  emailMode = null;
  signName.value = '';
  signEmail.value = '';
  resetTurnstile('sign');
  $('sign-preview').textContent = `“${draftText}”`;
  setSignStep(0);
  refreshSignStep0();
  refreshSignStep1();
  signScrim.hidden = false;
}

function closeSignModal() {
  signScrim.hidden = true;
  draftText = '';
}

choiceSign.addEventListener('click', () => { signMode = 'sign'; refreshSignStep0(); signName.focus(); });
choiceAnon.addEventListener('click', () => { signMode = 'anon'; signName.value = ''; refreshSignStep0(); });
signName.addEventListener('input', refreshSignStep0);
signContinue.addEventListener('click', () => setSignStep(1));

choiceEmail.addEventListener('click', () => { emailMode = 'leave'; refreshSignStep1(); signEmail.focus(); });
choiceSkip.addEventListener('click', () => { emailMode = 'skip'; signEmail.value = ''; refreshSignStep1(); });
signEmail.addEventListener('input', refreshSignStep1);
$('sign-back').addEventListener('click', () => setSignStep(0));

signPost.addEventListener('click', async () => {
  const author = signMode === 'sign' && signName.value.trim() ? signName.value.trim() : null;
  const email = emailMode === 'leave' && signEmail.value.trim() ? signEmail.value.trim() : null;
  const text = draftText;

  signPost.disabled = true;
  const res = await api('/api/notes', {
    method: 'POST',
    body: {
      text, author, email,
      turnstileToken: tsTokens.sign,
      elapsedMs: firstTypedAt ? Date.now() - firstTypedAt : null,
      website: $('hp-note').value, // honeypot — humans never see it
    },
  });

  if (res.ok && res.data && res.data.id) {
    // Saved server-side.
    firstTypedAt = null;
    userNotes.unshift({ id: res.data.id, text, author, hours: 0, plus: 0, createdAt: Math.floor(Date.now() / 1000) });
    if (serverTotal != null) serverTotal += 1;
    closeSignModal();
    renderCount();
    if (res.data.removalUrl) showRemoval(res.data.removalUrl, res.data.emailed);
    else showToast(res.data.pending ? "it's in — pending a quick review" : "it's up there now");
  } else if (res.status === 409) {
    // Someone already wrote exactly this — point them at "+ me too".
    closeSignModal();
    composerInput.value = text;
    composerInput.dispatchEvent(new Event('input'));
    setCollapsed(false);
    showToast(res.data?.reason || 'these exact words are already on the wall', 4600);
  } else if (res.status === 422) {
    // Blocked by moderation (PII / blocklist). Return the text so they can edit.
    closeSignModal();
    composerInput.value = text;
    composerInput.dispatchEvent(new Event('input'));
    setCollapsed(false);
    showToast(res.data?.reason || "that note can't be posted", 4200);
  } else if (res.status === 429) {
    signPost.disabled = false;
    showToast("you're posting a little fast — try again in a moment");
  } else if (res.status === 403) {
    resetTurnstile('sign');
    refreshSignStep1();
    showToast("couldn't verify you're human — please try again");
  } else {
    // No backend yet (503/local) or network error: keep it locally so the
    // person still feels heard. It becomes real once the DB is configured.
    userNotes.unshift({ id: 'u' + Date.now(), text, author, hours: 0, plus: 0, createdAt: Math.floor(Date.now() / 1000) });
    closeSignModal();
    renderCount();
    showToast("it's up there now");
  }
});

$('sign-close').addEventListener('click', closeSignModal);
$('sign-cancel').addEventListener('click', closeSignModal);
signScrim.addEventListener('click', (e) => { if (e.target === signScrim) closeSignModal(); });

// ---- removal-link modal (shown after a successful post) ----
const removalScrim = $('removal-scrim');
function showRemoval(url, emailed) {
  $('removal-link').value = url;
  $('removal-emailed').textContent = emailed
    ? 'We also emailed you a copy.'
    : 'This link is the only way to remove it later — keep it.';
  removalScrim.hidden = false;
}
$('removal-close').addEventListener('click', () => { removalScrim.hidden = true; });
$('removal-ok').addEventListener('click', () => { removalScrim.hidden = true; });
$('removal-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('removal-link').value); showToast('removal link copied'); } catch (_) {}
});
removalScrim.addEventListener('click', (e) => { if (e.target === removalScrim) removalScrim.hidden = true; });

// ---- note detail ----
const detailScrim = $('detail-scrim');
const actPlus = $('act-plus');
const actCopy = $('act-copy');

const COPY_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg><span class="act-count">copy</span>';
const COPIED_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 20 7"/></svg><span class="act-count">copied</span>';

function renderDetail() {
  const note = noteById(openNoteId);
  if (!note) return;
  $('detail-text').textContent = note.text;
  $('detail-author').textContent = `— ${displayAuthor(note.author)}`;
  $('detail-time').textContent = formatTime(note.hours);
  const delta = plusMap[openNoteId] || 0;
  actPlus.classList.toggle('is-on', delta > 0);
  $('act-plus-count').textContent = `+${formatPlus(note.plus + delta)}`;
}

function openNote(id) {
  openNoteId = id;
  $('act-copy-inner').innerHTML = COPY_ICON;
  renderDetail();
  detailScrim.hidden = false;
  for (const el of floaterEls) el.classList.toggle('is-hidden', el.dataset.noteId === id);
}

function closeNote() {
  openNoteId = null;
  detailScrim.hidden = true;
  for (const el of floaterEls) el.classList.remove('is-hidden');
  // Leaving a /n/<id> permalink: clean the address bar back to the wall.
  if (location.pathname.startsWith('/n/')) history.replaceState({}, '', '/');
}

actPlus.addEventListener('click', () => {
  if (!openNoteId || plusMap[openNoteId]) return;
  plusMap[openNoteId] = 1;
  renderDetail();
  api('/api/plus', { method: 'POST', body: { id: openNoteId } }); // fire and forget
});

actCopy.addEventListener('click', async () => {
  const note = noteById(openNoteId);
  if (!note) return;

  // Attributed copy: plain text everywhere, plus rich HTML (clickable link)
  // for targets that accept it (docs, LinkedIn, Slack…). One icon, one gesture.
  const author = displayAuthor(note.author);
  const when = formatDate(note.createdAt || Math.floor(Date.now() / 1000) - (note.hours || 0) * 3600);
  const url = noteUrl(note.id);
  const shortUrl = url.replace(/^https:\/\//, '');
  const plain = `${PROMPT}\n"${note.text}" - ${author}\n${url} · ${when}`;
  const rich =
    `<p>${escHtml(PROMPT)}<br>` +
    `&ldquo;${escHtml(note.text)}&rdquo; - ${escHtml(author)}<br>` +
    `<a href="${url}">${escHtml(shortUrl)}</a> · ${escHtml(when)}</p>`;

  try {
    if (window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([rich], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
  } catch (_) {
    try { await navigator.clipboard.writeText(plain); } catch (_) {}
  }

  $('act-copy-inner').innerHTML = COPIED_ICON;
  showToast('copied with link', 2200);
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $('act-copy-inner').innerHTML = COPY_ICON; }, 1600);
});

$('detail-close').addEventListener('click', closeNote);
detailScrim.addEventListener('click', (e) => { if (e.target === detailScrim) closeNote(); });

// ---- trending widget (top-right) ----
let widgetData = null;
let widgetTab = 'trending';
let wallGeneratedAt = null; // unix secs; from /api/wall for "refreshed Xm ago"

function renderRefreshedAgo() {
  const el = $('tw-refreshed');
  if (!el) return;
  if (!wallGeneratedAt) { el.hidden = true; return; }
  const mins = Math.max(0, Math.floor(Date.now() / 1000 - wallGeneratedAt) / 60 | 0);
  el.textContent = mins < 1 ? 'refreshed just now' : `refreshed ${mins} min ago`;
  el.hidden = false;
}
setInterval(renderRefreshedAgo, 30_000);

function fallbackWidgets() {
  const byPlus = [...FALLBACK_NOTES].sort((a, b) => b.plus - a.plus).slice(0, 10);
  const byRecent = [...FALLBACK_NOTES].sort((a, b) => a.hours - b.hours).slice(0, 10);
  return { trending: byPlus, top: byPlus, recent: byRecent };
}

function renderWidgets(data) {
  widgetData = data || fallbackWidgets();
  widgetNotes = [
    ...(widgetData.trending || []),
    ...(widgetData.top || []),
    ...(widgetData.recent || []),
  ];
  renderWidgetList();
  $('trending-widget').hidden = false;
}

function renderWidgetList() {
  const list = $('tw-list');
  if (!list || !widgetData) return;
  const items = widgetData[widgetTab] || [];
  list.textContent = '';
  items.forEach((n, i) => {
    const li = document.createElement('li');
    li.className = 'tw-item';
    const rank = document.createElement('span');
    rank.className = 'tw-rank';
    rank.textContent = String(i + 1);
    const txt = document.createElement('button');
    txt.className = 'tw-text';
    txt.textContent = truncate(n.text, 46);
    txt.addEventListener('click', () => openNote(n.id));
    const meta = document.createElement('span');
    meta.className = 'tw-meta';
    meta.textContent = widgetTab === 'recent' ? formatTimeShort(n.hours) : `+${formatPlus(n.plus)}`;
    li.append(rank, txt, meta);
    list.appendChild(li);
  });
}

$('tw-toggle').addEventListener('click', () => {
  const panel = $('tw-panel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('tw-toggle').setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.tw-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    widgetTab = tab.dataset.tab;
    document.querySelectorAll('.tw-tab').forEach((t) => t.classList.toggle('is-on', t === tab));
    renderWidgetList();
  });
});

// ---- feedback widget (bottom-right) ----
const fwPop = $('fw-pop');
const fwText = $('fw-text');
const fwEmail = $('fw-email');
const fwSend = $('fw-send');

function refreshFeedback() {
  fwSend.disabled = !fwText.value.trim() || (turnstileRequired() && !tsTokens.feedback);
}

$('fw-btn').addEventListener('click', () => {
  const open = fwPop.hidden;
  fwPop.hidden = !open;
  if (open) { mountTurnstile($('fw-turnstile'), 'feedback'); fwText.focus(); }
});
$('fw-close').addEventListener('click', () => { fwPop.hidden = true; });
fwText.addEventListener('input', refreshFeedback);

fwSend.addEventListener('click', async () => {
  const text = fwText.value.trim();
  if (!text) return;
  fwSend.disabled = true;
  const res = await api('/api/feedback', {
    method: 'POST',
    body: {
      text, email: fwEmail.value.trim() || null,
      turnstileToken: tsTokens.feedback,
      website: $('hp-feedback').value, // honeypot
    },
  });
  if (res.ok || res.status === 503) {
    fwText.value = '';
    fwEmail.value = '';
    resetTurnstile('feedback');
    fwPop.hidden = true;
    showToast('thank you — got it');
  } else if (res.status === 429) {
    fwSend.disabled = false;
    showToast('easy there — try again in a moment');
  } else {
    fwSend.disabled = false;
    showToast("couldn't send — please try again");
  }
});

// ---- disclaimer ----
const disclaimerScrim = $('disclaimer-scrim');
$('disclaimer-open').addEventListener('click', () => { disclaimerScrim.hidden = false; });
$('disclaimer-close').addEventListener('click', () => { disclaimerScrim.hidden = true; });
$('disclaimer-ok').addEventListener('click', () => { disclaimerScrim.hidden = true; });
disclaimerScrim.addEventListener('click', (e) => { if (e.target === disclaimerScrim) disclaimerScrim.hidden = true; });

// ---- escape key ----
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openNoteId) closeNote();
  else if (!removalScrim.hidden) removalScrim.hidden = true;
  else if (!signScrim.hidden) closeSignModal();
  else if (!disclaimerScrim.hidden) disclaimerScrim.hidden = true;
  else if (!fwPop.hidden) fwPop.hidden = true;
});

// ---- load live data ----
// light=true refreshes counters + widgets only (no wall rebuild), so the
// periodic refetch never visually resets the drifting notes.
async function loadWall(light = false) {
  const res = await api('/api/wall');
  const data = res.data;
  if (data && data.config) wallConfig = data.config;

  if (data && data.configured && Array.isArray(data.wall) && data.wall.length) {
    wallNotes = data.wall;
    if (!light) {
      ROWS = buildRows(wallNotes, L.rows, L.stride);
      buildFloaters();
    }
    if (typeof data.total === 'number') { serverTotal = data.total; serverAi = data.aiTotal || 0; renderCount(); }
    if (typeof data.generatedAt === 'number') { wallGeneratedAt = data.generatedAt; renderRefreshedAgo(); }
    renderWidgets(data.widgets);
  } else if (!light) {
    renderWidgets(fallbackWidgets());
  }
}

// Keep long-open tabs fresh: refetch every 5 min (CDN-cached — no DB cost).
setInterval(() => loadWall(true), 300_000);

// ---- init ----
renderCount();
rebuild();
requestAnimationFrame(opacityLoop);
loadWall();

// Deep link (/n/<id>): the permalink page embeds the note as an inert JSON
// data block (CSP-safe — inline executable scripts are forbidden), so the
// note opens instantly with no extra API round-trip.
(() => {
  const el = document.getElementById('deep-note');
  if (!el) return;
  try {
    const dn = JSON.parse(el.textContent);
    if (dn && dn.id && dn.text) {
      userNotes.push(dn);
      openNote(dn.id);
    }
  } catch (_) { /* malformed payload — just show the wall */ }
})();
