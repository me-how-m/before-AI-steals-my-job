// libSQL / Turso client factory. Returns null (not a throw) when the DB
// isn't configured yet, so every endpoint can degrade gracefully.

import { createClient } from '@libsql/client';

let _client = undefined;

export function db() {
  if (_client !== undefined) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    _client = null;
    return null;
  }
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _client;
}

export function hasDb() {
  return !!process.env.TURSO_DATABASE_URL;
}
