#!/usr/bin/env node
/**
 * apply-migration.mjs
 *
 * Three modes:
 *
 *   node scripts/apply-migration.mjs --baseline
 *     FIRST-RUN ONLY — for existing production databases where migrations
 *     were previously applied manually.  Creates the schema_migrations
 *     tracking table and marks every file in supabase/migrations/ as
 *     "already applied" WITHOUT executing any SQL.  Run this ONCE via
 *     the manual "workflow_dispatch" trigger before enabling automatic
 *     migration on push-to-main.
 *
 *   node scripts/apply-migration.mjs --all
 *     Applies every pending migration in supabase/migrations/ that has not
 *     yet been recorded in the schema_migrations tracking table.
 *     Safe to run repeatedly — already-recorded files are skipped.
 *     Creates the tracking table automatically on first run.
 *     Each migration is applied and recorded in a single PostgreSQL
 *     transaction so a mid-flight failure never leaves the tracking table
 *     inconsistent with the actual DB state.
 *
 *   node scripts/apply-migration.mjs <file>
 *     Applies a single migration file (original behaviour, useful for
 *     one-off manual runs during development).
 *
 * Required env vars:
 *   SUPABASE_ACCESS_TOKEN   — Supabase personal access token
 *   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL — project URL
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

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

function sha256Of(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) {
    fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.');
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
      'SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at ' +
        'https://supabase.com/dashboard/account/tokens and add it as a GitHub ' +
        'repo secret (Settings → Secrets and variables → Actions → SUPABASE_ACCESS_TOKEN).'
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
    console.error('\x1b[31mResponse:\x1b[0m', body);
    fail(`Supabase Management API returned ${res.status} ${res.statusText}`);
  }

  return body;
}

async function ensureTrackingTable(ref, token) {
  info('Ensuring schema_migrations tracking table exists…');
  await runQuery(
    ref,
    token,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      sha256     TEXT NOT NULL DEFAULT '',
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`
  );
  ok('schema_migrations table ready');
}

async function getAppliedMigrations(ref, token) {
  const rows = await runQuery(
    ref,
    token,
    `SELECT filename FROM schema_migrations ORDER BY filename;`
  );
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map((r) => r.filename));
}

/**
 * Applies one migration file AND records it in schema_migrations inside a
 * single PostgreSQL transaction.  If either step fails the whole transaction
 * is rolled back, keeping the tracking table consistent with the actual DB
 * state (no partial "applied but not recorded" or "recorded but failed" rows).
 */
async function applySingleFile(ref, token, filePath) {
  const sql = await readFile(filePath, 'utf8');
  const name = path.basename(filePath);

  if (!sql.trim()) {
    fail(`Migration is empty: ${name}`);
  }

  info(`Applying ${name} to project ${ref} …`);

  const safeName = name.replace(/'/g, "''");
  const hash = sha256Of(sql);
  const wrappedSql =
    `BEGIN;\n` +
    `${sql}\n` +
    `;\n` +
    `INSERT INTO schema_migrations (filename, sha256)\n` +
    `  VALUES ('${safeName}', '${hash}')\n` +
    `  ON CONFLICT (filename) DO NOTHING;\n` +
    `COMMIT;`;

  await runQuery(ref, token, wrappedSql);
  ok(`Applied ${name}`);
}

// ── --all ────────────────────────────────────────────────────────────────────

async function applyAll() {
  const token = getToken();
  const ref = getProjectRef();

  const allFiles = await listMigrations();
  if (allFiles.length === 0) {
    warn('No migration files found in supabase/migrations/ — nothing to do.');
    return;
  }

  info(`Found ${allFiles.length} migration file(s) in supabase/migrations/`);

  await ensureTrackingTable(ref, token);
  const applied = await getAppliedMigrations(ref, token);

  info(`Already applied: ${applied.size} migration(s)`);

  const pending = allFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    ok('All migrations are already applied — nothing to do.');
    return;
  }

  info(`Pending: ${pending.length} migration(s) — ${pending.join(', ')}`);

  let successCount = 0;
  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    await applySingleFile(ref, token, filePath);
    successCount++;
  }

  ok(`Done — applied ${successCount} new migration(s).`);
}

// ── --baseline ───────────────────────────────────────────────────────────────

/**
 * FIRST-RUN ONLY.
 *
 * For existing production databases where all migrations were previously
 * applied manually via the Supabase Dashboard.  Creates the schema_migrations
 * tracking table and inserts every current migration filename WITHOUT
 * executing any SQL.
 *
 * After baseline, only migrations added AFTER this point will be executed
 * by --all.  Run this once via the manual GitHub Actions workflow_dispatch
 * trigger before enabling automatic migration-on-push.
 */
async function applyBaseline() {
  const token = getToken();
  const ref = getProjectRef();

  const allFiles = await listMigrations();
  if (allFiles.length === 0) {
    warn('No migration files found in supabase/migrations/ — nothing to baseline.');
    return;
  }

  info(`Baseline: marking ${allFiles.length} existing migration(s) as already applied`);
  info('(No SQL will be executed — these files are assumed to be in production already.)');

  await ensureTrackingTable(ref, token);
  const alreadyRecorded = await getAppliedMigrations(ref, token);

  let count = 0;
  for (const filename of allFiles) {
    if (alreadyRecorded.has(filename)) {
      info(`  skip (already recorded): ${filename}`);
      continue;
    }
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = await readFile(filePath, 'utf8');
    const hash = sha256Of(sql);
    const safeName = filename.replace(/'/g, "''");
    await runQuery(
      ref,
      token,
      `INSERT INTO schema_migrations (filename, sha256)
       VALUES ('${safeName}', '${hash}')
       ON CONFLICT (filename) DO NOTHING;`
    );
    ok(`  baselined: ${filename}`);
    count++;
  }

  if (count === 0) {
    ok('All files were already recorded — nothing new to baseline.');
  } else {
    ok(`Baseline complete — recorded ${count} file(s).`);
    ok('From now on, --all will only apply NEW migration files added after this baseline.');
  }
}

// ── single-file mode (original behaviour) ────────────────────────────────────

async function resolveMigrationFile(arg) {
  const candidates = [
    arg,
    path.join(MIGRATIONS_DIR, arg),
    path.join(MIGRATIONS_DIR, arg.endsWith('.sql') ? arg : `${arg}.sql`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return path.resolve(c);
  }
  fail(`Migration file not found: ${arg}`);
}

async function applySingleFileManual(filePath) {
  const token = getToken();
  const ref = getProjectRef();
  await applySingleFile(ref, token, filePath);
}

// ── entry point ──────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg) {
  const files = await listMigrations();
  console.error('Usage:');
  console.error('  node scripts/apply-migration.mjs --baseline   # first-run: mark existing as applied');
  console.error('  node scripts/apply-migration.mjs --all        # apply all pending (normal mode)');
  console.error('  node scripts/apply-migration.mjs <file>       # apply one file');
  console.error('');
  console.error('Available migrations in supabase/migrations/:');
  for (const f of files) console.error(`  - ${f}`);
  process.exit(1);
}

if (arg === '--baseline') {
  await applyBaseline();
} else if (arg === '--all') {
  await applyAll();
} else {
  const file = await resolveMigrationFile(arg);
  await applySingleFileManual(file);
}
