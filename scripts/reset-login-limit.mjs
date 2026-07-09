#!/usr/bin/env node
// Clears the admin-login rate-limit rows (use if you lock yourself out).
//   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node scripts/reset-login-limit.mjs

import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
if (!url) { console.error('✗ set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN)'); process.exit(1); }

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await client.execute("DELETE FROM rate_limits WHERE key LIKE 'admin-login:%'");
console.log('✓ cleared admin-login rate-limit rows:', r.rowsAffected);
