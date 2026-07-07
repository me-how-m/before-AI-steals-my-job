/* Before AI steals my job… — vanilla JS implementation of the Claude Design prototype. */

// ---- config ----
const PROMPT = 'Before AI steals my job…';
const BASE_COUNT = 124583;
const FLOATER_W = 260;
const FLOATER_GAP = 24;
const FLOATER_H = 44;

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

const truncate = (s, n = 30) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

const $ = (id) => document.getElementById(id);

// ---- state ----
let userNotes = [];
let openNoteId = null;
const plusMap = {};
let draftText = '';
let signMode = null;   // 'sign' | 'anon' | null
let emailMode = null;  // 'leave' | 'skip' | null
let copyTimer = null;
let toastTimer = null;

const noteById = (id) => userNotes.find((n) => n.id === id) || SAMPLE_NOTES.find((n) => n.id === id) || null;

// ---- floating notes ----
const floatersEl = $('floaters');
let floaterEls = [];

function buildFloaters() {
  floatersEl.textContent = '';
  floaterEls = [];
  const vw = window.innerWidth;
  // Each note is offset by `slot/cycle * duration` so adjacent boxes are always
  // exactly `slot = W + 24px` apart while drifting — guaranteed no-overlap.
  const cycle = vw + FLOATER_W;
  const slot = FLOATER_W + FLOATER_GAP;
  const notesPerRow = Math.max(2, Math.floor(cycle / slot));
  ROWS.forEach((row) => {
    const stepDelay = (slot / cycle) * row.speed;
    for (let i = 0; i < notesPerRow; i++) {
      const note = noteById(row.notes[i % row.notes.length]);
      if (!note) continue;
      const btn = document.createElement('button');
      btn.className = 'floater' + (openNoteId === note.id ? ' is-hidden' : '');
      btn.dataset.noteId = note.id;
      btn.style.top = `calc(50% + ${row.dyPx}px)`;
      btn.style.width = `${FLOATER_W}px`;
      btn.style.height = `${FLOATER_H}px`;
      btn.style.animationName = row.dir > 0 ? 'driftRight' : 'driftLeft';
      btn.style.animationDuration = `${row.speed}s`;
      btn.style.animationDelay = `${-(i * stepDelay)}s`;
      btn.style.opacity = '0';
      const span = document.createElement('span');
      span.className = 'floater-text';
      span.textContent = truncate(note.text, 30);
      btn.appendChild(span);
      btn.addEventListener('click', () => openNote(note.id));
      floatersEl.appendChild(btn);
      floaterEls.push(btn);
    }
  });
}

// Fade floaters in toward the horizontal center, out toward the edges.
function opacityLoop() {
  const cx = window.innerWidth / 2;
  const maxDist = Math.max(window.innerWidth * 0.42, 1);
  for (const el of floaterEls) {
    const rect = el.getBoundingClientRect();
    const dist = Math.abs(rect.left + rect.width / 2 - cx);
    let o = 1 - dist / maxDist;
    o = Math.max(0, Math.min(1, o));
    el.style.opacity = String(Math.pow(o, 1.5) * 0.85);
  }
  requestAnimationFrame(opacityLoop);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(buildFloaters, 150);
});

// ---- brand counter ----
function renderCount() {
  $('brand-count').textContent = (BASE_COUNT + userNotes.length).toLocaleString();
}

// ---- toast ----
function showToast(msg, ms = 3200) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
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

composerInput.addEventListener('input', () => {
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
  signPost.disabled = emailMode === null || (emailMode === 'leave' && !signEmail.value.trim());
}

function openSignModal() {
  signMode = null;
  emailMode = null;
  signName.value = '';
  signEmail.value = '';
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

signPost.addEventListener('click', () => {
  const author = signMode === 'sign' && signName.value.trim() ? signName.value.trim() : null;
  const email = emailMode === 'leave' && signEmail.value.trim() ? signEmail.value.trim() : null;
  userNotes.unshift({ id: 'u' + Date.now(), text: draftText, author, hours: 0, plus: 0 });
  closeSignModal();
  renderCount();
  const bits = ["it's up there now"];
  if (email) bits.push("we'll send the removal link");
  showToast(bits.join(' — '));
});

$('sign-close').addEventListener('click', closeSignModal);
$('sign-cancel').addEventListener('click', closeSignModal);
signScrim.addEventListener('click', (e) => { if (e.target === signScrim) closeSignModal(); });

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
  $('detail-author').textContent = `— ${note.author || 'Anonymous'}`;
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
}

actPlus.addEventListener('click', () => {
  if (!openNoteId || plusMap[openNoteId]) return;
  plusMap[openNoteId] = 1;
  renderDetail();
});

actCopy.addEventListener('click', async () => {
  const note = noteById(openNoteId);
  if (!note) return;
  try { await navigator.clipboard.writeText(`${PROMPT} ${note.text}`); } catch (_) {}
  $('act-copy-inner').innerHTML = COPIED_ICON;
  showToast('copied to clipboard', 2200);
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $('act-copy-inner').innerHTML = COPY_ICON; }, 1600);
});

$('detail-close').addEventListener('click', closeNote);
detailScrim.addEventListener('click', (e) => { if (e.target === detailScrim) closeNote(); });

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
  else if (!signScrim.hidden) closeSignModal();
  else if (!disclaimerScrim.hidden) disclaimerScrim.hidden = true;
});

// ---- init ----
renderCount();
buildFloaters();
requestAnimationFrame(opacityLoop);
