#!/usr/bin/env node
// Verify that every column referenced by lib/*.ts column lists exists
// in the live Supabase tables. Several lib helpers retry inserts /
// selects after stripping columns when Postgres reports "column does
// not exist" (lib/meals.ts FULL_COLS → MID_COLS → CORE_COLS, plus the
// `bg_1h_at` / `bg_2h_at` retry; lib/insulin.ts, lib/exercise.ts,
// lib/fingerstick.ts, lib/symptoms.ts, lib/menstrual.ts each declare a
// `COLS` constant the insert/select chain reads from). When the live
// schema drifts from those constants the helpers either silently
// degrade (chips stuck in "VORLÄUFIG", missing macros, missing notes)
// or fail at runtime with cryptic 42703 errors deep inside a request.
// This script catches that drift loudly so a merged-but-not-applied
// migration is noticed before the first request.
//
// Usage:
//   node scripts/check-schema-drift.mjs
//
// Required env (same flow as scripts/apply-migration.mjs):
//   - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   - SUPABASE_ACCESS_TOKEN  (Supabase Management API personal token)
//
// Exit codes:
//   0  → all declared columns exist on every checked table
//   1  → at least one column is missing on at least one table
//   2  → environment / network / parse failure (cannot determine)
//   78 → skipped because SUPABASE_ACCESS_TOKEN is unset (use as a soft
//        no-op in post-merge; CI / deploy steps should treat as failure)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';
const CYN = '\x1b[36m';
const RST = '\x1b[0m';

function fail(msg, code = 2) {
  console.error(`${RED}✖ ${msg}${RST}`);
  process.exit(code);
}
function ok(msg) { console.log(`${GRN}✓ ${msg}${RST}`); }
function info(msg) { console.log(`${CYN}ℹ ${msg}${RST}`); }
function warn(msg) { console.warn(`${YLW}⚠ ${msg}${RST}`); }

// ---------------------------------------------------------------------------
// Config: every table that has a "drop on missing column" silent-fallback
// risk in lib/. Each entry maps a Supabase table to the source-of-truth
// column list(s) declared in lib/*.ts. Two extraction modes:
//   - { kind: 'const', file, constName }  → parses `const <name> = "a, b, c";`
//   - { kind: 'selects', files }           → unions every column referenced
//                                            in `.from("<table>").select("…")`
//                                            calls across the listed files
//                                            (used for tables like
//                                            `user_settings` where columns
//                                            are scattered across helpers
//                                            instead of one constant)
// ---------------------------------------------------------------------------
const CHECKS = [
  {
    table: 'meals',
    sources: [{ kind: 'const', file: 'lib/meals.ts', constName: 'FULL_COLS' }],
  },
  {
    table: 'insulin_logs',
    sources: [{ kind: 'const', file: 'lib/insulin.ts', constName: 'COLS' }],
  },
  {
    table: 'exercise_logs',
    sources: [{ kind: 'const', file: 'lib/exercise.ts', constName: 'COLS' }],
  },
  {
    table: 'fingerstick_readings',
    sources: [{ kind: 'const', file: 'lib/fingerstick.ts', constName: 'COLS' }],
  },
  {
    table: 'symptom_logs',
    sources: [{ kind: 'const', file: 'lib/symptoms.ts', constName: 'COLS' }],
  },
  {
    table: 'menstrual_logs',
    sources: [{ kind: 'const', file: 'lib/menstrual.ts', constName: 'COLS' }],
  },
  {
    table: 'user_settings',
    sources: [{
      kind: 'selects',
      files: [
        'lib/userSettings.ts',
        'lib/cyclePrefs.ts',
        'lib/notificationPrefs.ts',
        'lib/insulin.ts',
        'lib/icrSchedule.ts',
      ],
    }],
  },
];

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.');
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) fail(`Unable to extract project ref from Supabase URL: ${url}`);
  return m[1];
}

async function extractFromConst(file, constName) {
  const src = await readFile(path.join(ROOT, file), 'utf8');
  // Match `const <name> = "a, b, c";` (single-line string literal).
  const re = new RegExp(`const\\s+${constName}\\s*=\\s*"([^"]+)"`);
  const m = src.match(re);
  if (!m) fail(`Could not locate ${constName} constant in ${file}`);
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

// Walk a source file and union every column referenced in
// `.from("<table>")` … `.select("col1, col2, …")` chains. PostgREST
// allows the select() call to be on a separate line from the from(),
// so we scan a small forward window for the next `.select("…")`.
async function extractFromSelects(files, table) {
  const cols = new Set();
  for (const file of files) {
    const src = await readFile(path.join(ROOT, file), 'utf8');
    const fromRe = new RegExp(
      `\\.from\\(\\s*["']${table}["']\\s*\\)([\\s\\S]{0,400}?)\\.select\\(\\s*["']([^"']+)["']`,
      'g',
    );
    let m;
    while ((m = fromRe.exec(src)) !== null) {
      for (const c of m[2].split(',')) {
        const name = c.trim();
        // Skip wildcard / nested-relation / aliased selects — we only
        // want plain column identifiers.
        if (!name || name === '*' || name.includes('(') || name.includes(':')) continue;
        cols.add(name);
      }
    }
  }
  return [...cols];
}

async function resolveColumns(check) {
  const cols = new Set();
  for (const src of check.sources) {
    if (src.kind === 'const') {
      for (const c of await extractFromConst(src.file, src.constName)) cols.add(c);
    } else if (src.kind === 'selects') {
      for (const c of await extractFromSelects(src.files, check.table)) cols.add(c);
    } else {
      fail(`Unknown source kind '${src.kind}' for table '${check.table}'`);
    }
  }
  return [...cols];
}

async function fetchLiveColumns(ref, token, table) {
  const sql =
    "select column_name from information_schema.columns " +
    `where table_schema='public' and table_name='${table}'`;
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
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    console.error(`${RED}Response:${RST}`, body);
    fail(`Supabase Management API returned ${res.status} ${res.statusText} for ${table}`);
  }
  if (!Array.isArray(body)) {
    fail(`Unexpected response shape from Supabase Management API for ${table}: ${text.slice(0, 200)}`);
  }
  return new Set(body.map((r) => r.column_name));
}

async function main() {
  // Resolve every table's expected column set up front so a typo in the
  // CHECKS config (e.g. wrong constName) fails before any network work.
  const resolved = [];
  for (const check of CHECKS) {
    const expected = await resolveColumns(check);
    if (expected.length === 0) {
      fail(`No columns resolved for table '${check.table}' — check sources config.`);
    }
    info(`${check.table}: ${expected.length} columns declared in lib/`);
    resolved.push({ table: check.table, expected });
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    warn(
      'SUPABASE_ACCESS_TOKEN is not set — skipping live schema check. ' +
      'Set it (Replit secret or Vercel env var) to enforce drift detection.'
    );
    process.exit(78);
  }

  const ref = getProjectRef();
  info(`Checking project ${ref} …`);

  let driftCount = 0;
  for (const { table, expected } of resolved) {
    const live = await fetchLiveColumns(ref, token, table);
    if (live.size === 0) {
      console.error(
        `${RED}✖ Table public.${table} has no columns (does the table exist?).${RST}`
      );
      driftCount += 1;
      continue;
    }
    const missing = expected.filter((c) => !live.has(c));
    if (missing.length === 0) {
      ok(`public.${table}: all ${expected.length} declared columns exist`);
      continue;
    }
    console.error(
      `${RED}✖ Missing column(s) on public.${table}:${RST}`
    );
    for (const c of missing) console.error(`  - ${table}.${c}`);
    driftCount += missing.length;
  }

  if (driftCount === 0) {
    ok('No schema drift detected across any checked table.');
    process.exit(0);
  }

  console.error('');
  console.error(
    `${RED}✖ ${driftCount} column(s) missing across one or more tables.${RST}`
  );
  console.error(
    'Apply the corresponding migration(s) under supabase/migrations/ via ' +
    '`npm run db:migrate <file>` or the Supabase SQL editor, then re-run this check.'
  );
  process.exit(1);
}

main().catch((err) => {
  fail(`Unexpected error: ${err?.message ?? err}`);
});
