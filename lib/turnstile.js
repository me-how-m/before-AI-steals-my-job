// Cloudflare Turnstile server-side verification.
// If TURNSTILE_SECRET_KEY is unset, verification is skipped (returns true) so
// local/dev and pre-Phase-0 deploys still work. In production, set the key.

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured → don't block
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: String(token), remoteip: ip || '' }),
    });
    const data = await r.json();
    return !!data.success;
  } catch {
    return false;
  }
}
