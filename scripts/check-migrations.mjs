#!/usr/bin/env node
/**
 * check-migrations.mjs
 *
 * Compares the SQL files in supabase/migrations/ against the
 * schema_migrations tracking table in production to surface any
 * unapplied migrations before they cause user-facing errors.
 *
 * Usage:
 *   node scripts/check-migrations.mjs
 *   pnpm migrations:check
 *
 * Exit codes:
 *   0 — all local migrations are applied in production
 *   1 — one or more migrations are missing from production (or error)
 *
 * Required env vars:
 *   SUPABASE_ACCESS_TOKEN             — Supabase personal access token
 *   NEXT_PUBLIC_SUPABASE_URL          — or SUPABASE_URL — project URL
 *
 * Tip: add `pnpm migrations:check` as a pre-deploy step in CI to catch
 * unapplied migrations before they reach production traffic.
 */

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

// ── Colours ──────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
}

function info(msg) {
  console.log(`\x1b[36mℹ ${msg}\x1b[0m`);
}

function ok(msg) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function warn(msg) {
  console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

function error(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) {
    fail(
      'NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.\n' +
        '  Add it to your environment or .env.local file.'
    );
  }
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) {
    fail(`Unable to extract project ref from Supabase URL: ${url}`);
  }
  return m[1];
}

function getToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set.\n' +
        '  Create a personal access token at https://supabase.com/dashboard/account/tokens\n' +
        '  and set it as SUPABASE_ACCESS_TOKEN in your environment or Replit Secrets.'
    );
  }
  return token;
}

async function runQuery(ref, token, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error('\x1b[31mManagement API response:\x1b[0m', body);
    fail(`Supabase Management API returned ${res.status} ${res.statusText}`);
  }

  return body;
}

async function listLocalMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Returns the set of filenames recorded in schema_migrations.
 * Returns null if the tracking table does not exist yet (i.e. apply-migration
 * --baseline has never been run).
 */
async function getAppliedMigrations(ref, token) {
  // Check whether the tracking table exists first so we can give a clear error.
  const existsRows = await runQuery(
    ref,
    token,
    `SELECT to_regclass('public.schema_migrations') AS tbl;`
  );

  const tbl = Array.isArray(existsRows) ? existsRows[0]?.tbl : null;
  if (!tbl) {
    return null; // table not present
  }

  const rows = await runQuery(
    ref,
    token,
    `SELECT filename FROM schema_migrations ORDER BY filename;`
  );
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map((r) => r.filename));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const token = getToken();
const ref = getProjectRef();

info(`Checking migrations for project: ${ref}`);

const localFiles = await listLocalMigrations();

if (localFiles.length === 0) {
  warn('No .sql files found in supabase/migrations/ — nothing to check.');
  process.exit(0);
}

info(`Local migrations found: ${localFiles.length}`);

const applied = await getAppliedMigrations(ref, token);

if (applied === null) {
  error(
    'The schema_migrations tracking table does not exist in production.\n' +
      '  Run `pnpm db:migrate:baseline` once to initialise it, then re-run this check.'
  );
  process.exit(1);
}

info(`Migrations recorded in production (schema_migrations): ${applied.size}`);

const pending = localFiles.filter((f) => !applied.has(f));
const extraInProd = [...applied].filter((f) => !localFiles.includes(f));

console.log('');

if (pending.length === 0) {
  ok(`All ${localFiles.length} local migrations are applied in production.`);
} else {
  error(`${pending.length} migration(s) are NOT applied in production:\n`);
  for (const f of pending) {
    console.error(`  \x1b[31m• ${f}\x1b[0m`);
  }
  console.log('');
  warn(
    'Run `pnpm db:migrate:all` to apply pending migrations, or apply them\n' +
      '  manually via the Supabase Dashboard SQL Editor.'
  );
}

if (extraInProd.length > 0) {
  console.log('');
  warn(
    `${extraInProd.length} migration(s) are recorded in production but have no local .sql file:\n`
  );
  for (const f of extraInProd) {
    console.log(`  \x1b[33m• ${f}\x1b[0m`);
  }
  warn(
    'This usually means a file was deleted locally after being applied.\n' +
      '  It is safe to ignore if the deletion was intentional.'
  );
}

console.log('');

if (pending.length > 0) {
  process.exit(1);
}
