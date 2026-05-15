#!/usr/bin/env node
// Verify that every column referenced by lib/meals.ts::FULL_COLS exists
// in the live Supabase `meals` table. The fetchMeals() select() chain
// silently falls through from FULL_COLS → MID_COLS → CORE_COLS when a
// column is missing, which strips every curve-aggregate column and
// leaves chips stuck in "VORLÄUFIG" with no error surfacing. This
// script catches that drift loudly so a merged-but-not-applied
// migration is noticed before the first request, not via "why are all
// my chips provisional?".
//
// Usage:
//   node scripts/check-meals-schema.mjs
//
// Required env (same flow as scripts/apply-migration.mjs):
//   - NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   - SUPABASE_ACCESS_TOKEN  (Supabase Management API personal token)
//
// Exit codes:
//   0  → all FULL_COLS columns exist
//   1  → at least one column is missing (drift detected)
//   2  → environment / network / parse failure (cannot determine)
//   78 → skipped because SUPABASE_ACCESS_TOKEN is unset (use as a soft
//        no-op in post-merge; CI / deploy steps should treat as failure)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MEALS_TS = path.join(ROOT, 'lib', 'meals.ts');

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

function getProjectRef() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set.');
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) fail(`Unable to extract project ref from Supabase URL: ${url}`);
  return m[1];
}

async function parseFullCols() {
  const src = await readFile(MEALS_TS, 'utf8');
  // Match `const FULL_COLS = "id, user_id, ...";`
  const m = src.match(/const\s+FULL_COLS\s*=\s*"([^"]+)"/);
  if (!m) fail('Could not locate FULL_COLS constant in lib/meals.ts');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

async function fetchLiveMealsColumns(ref, token) {
  const sql =
    "select column_name from information_schema.columns " +
    "where table_schema='public' and table_name='meals'";
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
    fail(`Supabase Management API returned ${res.status} ${res.statusText}`);
  }
  if (!Array.isArray(body)) {
    fail(`Unexpected response shape from Supabase Management API: ${text.slice(0, 200)}`);
  }
  return new Set(body.map((r) => r.column_name));
}

async function main() {
  const expected = await parseFullCols();
  info(`FULL_COLS declares ${expected.length} columns in lib/meals.ts`);

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
  const live = await fetchLiveMealsColumns(ref, token);

  const missing = expected.filter((c) => !live.has(c));
  if (missing.length === 0) {
    ok(`All ${expected.length} FULL_COLS columns exist on public.meals`);
    process.exit(0);
  }

  console.error(
    `${RED}✖ Missing column(s) on public.meals (FULL_COLS drift):${RST}`
  );
  for (const c of missing) console.error(`  - ${c}`);
  console.error('');
  console.error(
    'Apply the corresponding migration(s) under supabase/migrations/ via ' +
    '`npm run db:migrate <file>` or the Supabase SQL editor, then re-run this check.'
  );
  process.exit(1);
}

main().catch((err) => {
  fail(`Unexpected error: ${err?.message ?? err}`);
});
