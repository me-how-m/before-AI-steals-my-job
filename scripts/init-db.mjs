#!/usr/bin/env node
// Applies db/schema.sql to your Turso database.
// Usage:
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run init-db
// or point it at a local file for testing:
//   TURSO_DATABASE_URL=file:local.db npm run init-db

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('✗ Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for a hosted db).');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = await readFile(join(here, '..', 'db', 'schema.sql'), 'utf8');

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await client.executeMultiple(schema);

const tables = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
);
console.log('✓ Schema applied. Tables:', tables.rows.map((r) => r.name).join(', '));
