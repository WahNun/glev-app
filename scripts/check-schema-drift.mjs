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
// column list(s) declared in lib/*.ts. Three extraction modes:
//   - { kind: 'const', file, constName }  → parses `const <name> = "a, b, c";`
//   - { kind: 'selects', files }          → unions every column referenced
//                                           in `.from("<table>").select("…")`
//                                           calls across the listed files
//                                           (used for tables like
//                                           `user_settings` where columns
//                                           are scattered across helpers
//                                           instead of one constant)
//   - { kind: 'writes', files }           → unions every column referenced
//                                           on the WRITE side — keys passed
//                                           to `.insert(...)` / `.upsert(...)`
//                                           / `.update(...)` after a
//                                           matching `.from("<table>")`,
//                                           including identifier-based
//                                           payloads (`row`, `dbPatch`, …)
//                                           and `arr.map(s => ({…}))` rows.
//                                           Catches drift on write-only
//                                           columns (e.g. icr_g_per_ie_at_log,
//                                           engine_icr_auto_apply,
//                                           phase_marker, adjustment_history)
//                                           that the read-side selects miss.
// ---------------------------------------------------------------------------
const CHECKS = [
  {
    table: 'meals',
    sources: [
      { kind: 'const', file: 'lib/meals.ts', constName: 'FULL_COLS' },
      { kind: 'writes', files: ['lib/meals.ts'] },
    ],
  },
  {
    table: 'insulin_logs',
    sources: [
      { kind: 'const', file: 'lib/insulin.ts', constName: 'COLS' },
      { kind: 'writes', files: ['lib/insulin.ts'] },
    ],
  },
  {
    table: 'exercise_logs',
    sources: [
      { kind: 'const', file: 'lib/exercise.ts', constName: 'COLS' },
      { kind: 'writes', files: ['lib/exercise.ts'] },
    ],
  },
  {
    table: 'fingerstick_readings',
    sources: [
      { kind: 'const', file: 'lib/fingerstick.ts', constName: 'COLS' },
      { kind: 'writes', files: ['lib/fingerstick.ts'] },
    ],
  },
  {
    table: 'symptom_logs',
    sources: [
      { kind: 'const', file: 'lib/symptoms.ts', constName: 'COLS' },
      { kind: 'writes', files: ['lib/symptoms.ts'] },
    ],
  },
  {
    table: 'menstrual_logs',
    sources: [
      { kind: 'const', file: 'lib/menstrual.ts', constName: 'COLS' },
      { kind: 'writes', files: ['lib/menstrual.ts'] },
    ],
  },
  {
    table: 'user_settings',
    sources: [
      {
        kind: 'selects',
        files: [
          'lib/userSettings.ts',
          'lib/cyclePrefs.ts',
          'lib/notificationPrefs.ts',
          'lib/insulin.ts',
          'lib/icrSchedule.ts',
        ],
      },
      {
        kind: 'writes',
        files: [
          'lib/userSettings.ts',
          'lib/cyclePrefs.ts',
          'lib/notificationPrefs.ts',
          'lib/icrSchedule.ts',
        ],
      },
    ],
  },
  {
    table: 'user_icr_schedule',
    sources: [{ kind: 'writes', files: ['lib/icrSchedule.ts'] }],
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

// ---------------------------------------------------------------------------
// Write-side extractor: walks every `.from("<table>")` site in the listed
// files and unions every column key that ends up being passed to a
// following `.insert(...)` / `.upsert(...)` / `.update(...)` call. Two
// payload shapes are handled:
//
//   1. Inline object literal:
//        .upsert({ user_id: u, engine_icr_auto_apply: enabled }, { ... })
//      → keys are read straight off the literal.
//
//   2. Identifier (most common — `row`, `dbPatch`, `patch`, `updates`,
//      `legacyPatch`, `rows`, …):
//        const row: Record<string, unknown> = { user_id: ..., units: ... };
//        if (input.at) row.created_at = input.at;
//        await supabase.from("insulin_logs").insert(row).select(COLS);
//      → we resolve the identifier by scanning the same file for:
//        - `(const|let|var) <id> ... = { ... }` literal initialisers
//        - `(const|let|var) <id> = arr.map(... => ({ ... }))` row arrays
//        - `<id>.<key> = ...` and `<id>["<key>"] = ...` property writes
//        Every collected key is attributed to this table. This is safe
//        because the helper files are deliberately scoped to one table
//        each (lib/insulin.ts → insulin_logs, lib/menstrual.ts →
//        menstrual_logs, …) — see the `files:` lists in CHECKS.
//
// Anything we cannot statically resolve (computed keys `[expr]: …`,
// spread expressions `...other`, dynamic keys built from variables) is
// silently skipped — the goal is to catch the typo / missing-migration
// drift case, not to be a full TS parser.
// ---------------------------------------------------------------------------

// Walk a string starting AFTER the opening `(` of a call and return the
// substring containing only the FIRST argument (stops at the first
// top-level comma or the matching `)`). Quote-aware so commas inside
// string literals don't terminate the arg.
function extractFirstArg(src, openParenIdx) {
  let i = openParenIdx + 1;
  const start = i;
  let depth = 0; // bracket depth INSIDE the arg (parens/braces/squares)
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++; continue;
    }
    if (c === '(' || c === '{' || c === '[') { depth++; i++; continue; }
    if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) break;
      depth--; i++; continue;
    }
    if (c === ',' && depth === 0) break;
    i++;
  }
  return src.slice(start, i).trim();
}

// Walk a string starting AT an opening `{` and return the substring
// inside (excluding the outer braces). Quote-aware bracket counter.
function extractBraceBody(src, openBraceIdx) {
  let i = openBraceIdx + 1;
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++; continue;
    }
    if (c === '{' || c === '(' || c === '[') { depth++; i++; continue; }
    if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) break;
      depth--; i++; continue;
    }
    i++;
  }
  return src.slice(start, i);
}

// Parse the body of an object literal (i.e. content between `{` and `}`)
// and return its top-level property keys. Handles string keys,
// shorthand identifier keys, trailing commas, nested objects/arrays in
// the value position, and skips computed keys / spread expressions.
function parseObjectKeys(body) {
  const keys = [];
  let i = 0;
  while (i < body.length) {
    // Skip whitespace, commas, and line comments.
    while (i < body.length) {
      const c = body[i];
      if (/[\s,]/.test(c)) { i++; continue; }
      if (c === '/' && body[i + 1] === '/') {
        while (i < body.length && body[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && body[i + 1] === '*') {
        i += 2;
        while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      break;
    }
    if (i >= body.length) break;

    // Skip spread `...expr` — value, no key.
    if (body[i] === '.' && body[i + 1] === '.' && body[i + 2] === '.') {
      i = skipValue(body, i);
      continue;
    }

    // Parse key.
    let key = null;
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      const s = i;
      while (i < body.length && body[i] !== q) {
        if (body[i] === '\\') { i += 2; continue; }
        i++;
      }
      key = body.slice(s, i);
      i++;
    } else if (c === '[') {
      // Computed key — skip whole `[...]` block, leave key=null.
      let d = 1; i++;
      while (i < body.length && d > 0) {
        if (body[i] === '[') d++;
        else if (body[i] === ']') d--;
        i++;
      }
    } else if (/[A-Za-z_$]/.test(c)) {
      const s = i;
      while (i < body.length && /[A-Za-z0-9_$]/.test(body[i])) i++;
      key = body.slice(s, i);
    } else {
      // Unrecognised — skip one char to avoid infinite loop.
      i++;
      continue;
    }

    // Skip whitespace.
    while (i < body.length && /\s/.test(body[i])) i++;

    if (i < body.length && body[i] === ':') {
      // `key: value` — record key, skip value.
      if (key) keys.push(key);
      i++;
      i = skipValue(body, i);
    } else {
      // Shorthand `key` or `key,` or method `key(`.
      // Methods have `(` next at depth 0 — still a valid property key
      // (we just want the column name).
      if (key) keys.push(key);
      i = skipValue(body, i);
    }
  }
  return keys;
}

// Skip a single value expression starting at `i`, stopping at the next
// top-level comma or end of body. Quote-aware bracket counter.
function skipValue(body, i) {
  let depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < body.length && body[i] !== q) {
        if (body[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++; continue;
    }
    if (c === '(' || c === '{' || c === '[') { depth++; i++; continue; }
    if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) break;
      depth--; i++; continue;
    }
    if (c === ',' && depth === 0) break;
    i++;
  }
  return i;
}

// Extract every key written into `<table>` across one source file.
async function extractFromWrites(files, table) {
  const cols = new Set();
  for (const file of files) {
    const src = await readFile(path.join(ROOT, file), 'utf8');
    const fromRe = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`, 'g');
    let fm;
    while ((fm = fromRe.exec(src)) !== null) {
      // Look ahead for the next .insert / .upsert / .update call. We
      // cap the look-ahead at the NEXT `.from(...)` call so a select-
      // only chain (`.from("X").select(...)`) doesn't get incorrectly
      // attributed to a write that happens later for a different table.
      // The 4000-char outer cap is just a safety net for files with no
      // further `.from(` after this one.
      const fromEnd = fm.index + fm[0].length;
      let windowEnd = fromEnd + 4000;
      const nextFrom = /\.from\s*\(/.exec(src.slice(fromEnd));
      if (nextFrom) windowEnd = Math.min(windowEnd, fromEnd + nextFrom.index);
      const window = src.slice(fromEnd, windowEnd);
      const opMatch = /\.(insert|upsert|update)\s*\(/.exec(window);
      if (!opMatch) continue;
      const opOpenIdx = fromEnd + opMatch.index + opMatch[0].length - 1;
      const arg = extractFirstArg(src, opOpenIdx);
      if (!arg) continue;
      collectArgKeys(arg, src, cols);
    }
  }
  return [...cols];
}

// Resolve `arg` (the first argument expression of insert/upsert/update)
// into a set of column keys. Inline object literals are read directly;
// bare identifiers are resolved by scanning the source file for their
// initialiser and any property assignments.
function collectArgKeys(arg, src, cols) {
  const trimmed = arg.trim();
  if (trimmed.startsWith('{')) {
    const body = extractBraceBody(trimmed, 0);
    for (const k of parseObjectKeys(body)) cols.add(k);
    return;
  }
  // Bare identifier? (possibly followed by `as Foo` cast — strip it).
  const idMatch = trimmed.match(/^([A-Za-z_$][\w$]*)/);
  if (!idMatch) return;
  const id = idMatch[1];

  // Object-literal initialiser: `(const|let|var) <id> ... = { ... }`.
  // The optional `... ` swallows a TS type annotation (`: Record<…>`).
  const initRe = new RegExp(
    `(?:const|let|var)\\s+${id}\\b[^=;]*=\\s*\\{`,
    'g',
  );
  let im;
  while ((im = initRe.exec(src)) !== null) {
    const braceIdx = im.index + im[0].length - 1;
    const body = extractBraceBody(src, braceIdx);
    for (const k of parseObjectKeys(body)) cols.add(k);
  }

  // Map-style row arrays: `(const|let|var) <id> = … .map(… => ({ … }))`.
  const mapRe = new RegExp(
    `(?:const|let|var)\\s+${id}\\b[^=;]*=[^;]*?\\.map\\([^)]*?=>\\s*\\(?\\{`,
    'g',
  );
  let mm;
  while ((mm = mapRe.exec(src)) !== null) {
    const braceIdx = mm.index + mm[0].length - 1;
    const body = extractBraceBody(src, braceIdx);
    for (const k of parseObjectKeys(body)) cols.add(k);
  }

  // Property writes: `<id>.<key> = …` (but NOT `==`, `=>`).
  const propRe = new RegExp(`\\b${id}\\.([A-Za-z_$][\\w$]*)\\s*=(?![=>])`, 'g');
  let pm;
  while ((pm = propRe.exec(src)) !== null) {
    cols.add(pm[1]);
  }

  // Bracket writes: `<id>["<key>"] = …`.
  const propBracketRe = new RegExp(
    `\\b${id}\\[\\s*["']([^"']+)["']\\s*\\]\\s*=(?![=>])`,
    'g',
  );
  let pbm;
  while ((pbm = propBracketRe.exec(src)) !== null) {
    cols.add(pbm[1]);
  }
}

async function resolveColumns(check) {
  const cols = new Set();
  for (const src of check.sources) {
    if (src.kind === 'const') {
      for (const c of await extractFromConst(src.file, src.constName)) cols.add(c);
    } else if (src.kind === 'selects') {
      for (const c of await extractFromSelects(src.files, check.table)) cols.add(c);
    } else if (src.kind === 'writes') {
      for (const c of await extractFromWrites(src.files, check.table)) cols.add(c);
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
