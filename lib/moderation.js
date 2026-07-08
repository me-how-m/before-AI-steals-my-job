// Lightweight content moderation for public note submissions.
//
//  - Rejects obvious PII (email / phone / card / national-ID numbers) so people
//    don't accidentally doxx themselves or someone else on a public wall.
//  - Rejects a blocklist of terms, curated via the BLOCKLIST_TERMS env var
//    (comma-separated, case-insensitive) so it can be tuned without a redeploy.
//
// Deliberately conservative: this wall is emotional and personal, so we do NOT
// block mild profanity — only clear personal data and explicitly blocked terms.

function blockedTerms() {
  return (process.env.BLOCKLIST_TERMS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;

export function moderate(text) {
  const t = String(text || '');
  if (EMAIL.test(t)) return { ok: false, reason: 'Looks like it contains an email address — please take out personal info.' };
  if (SSN.test(t)) return { ok: false, reason: 'Looks like it contains a personal ID number — please take it out.' };
  if (hasCardNumber(t)) return { ok: false, reason: 'Looks like it contains a card number — please take it out.' };
  if (PHONE.test(t)) return { ok: false, reason: 'Looks like it contains a phone number — please take out personal info.' };

  const low = t.toLowerCase();
  for (const term of blockedTerms()) {
    if (wordHit(low, term)) return { ok: false, reason: 'That wording isn’t allowed here.' };
  }
  return { ok: true };
}

// Luhn-valid 13–19 digit run → very likely a real card number (few false positives).
function hasCardNumber(t) {
  for (const m of t.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
function luhn(s) {
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function wordHit(lowerText, term) {
  if (!term) return false;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i').test(lowerText);
}
