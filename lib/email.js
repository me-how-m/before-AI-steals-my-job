// Resend transactional email. The removal link is ALSO shown on-screen right
// after posting, so email is a courtesy copy, never load-bearing — if the key
// is missing or the daily cap is hit, nothing about the site breaks.

export async function sendRemovalEmail(to, noteText, removalUrl) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from || !to || !removalUrl) return { sent: false, reason: 'not-configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: 'Your note on “Before AI steals my job…”',
        text:
          `You left this note on the wall:\n\n` +
          `  "${noteText}"\n\n` +
          `If you ever want to take it down, open this link:\n${removalUrl}\n\n` +
          `Keep this email — it holds the only copy of your private removal link. ` +
          `We won't email you for anything else.`,
      }),
    });
    return { sent: r.ok, status: r.status };
  } catch {
    return { sent: false, reason: 'error' };
  }
}
