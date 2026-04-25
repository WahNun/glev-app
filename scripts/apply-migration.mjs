#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

async function resolveMigrationFile(arg) {
  if (!arg) {
    const files = await listMigrations();
    console.error('Usage: npm run db:migrate <migration-file>');
    console.error('');
    console.error('Available migrations in supabase/migrations/:');
    for (const f of files) console.error(`  - ${f}`);
    process.exit(1);
  }

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

async function applyMigration(filePath) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at ' +
        'https://supabase.com/dashboard/account/tokens and store it as a Replit secret.'
    );
  }

  const ref = getProjectRef();
  const sql = await readFile(filePath, 'utf8');
  const name = path.basename(filePath);

  if (!sql.trim()) {
    fail(`Migration is empty: ${name}`);
  }

  info(`Applying ${name} to project ${ref} …`);

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

  ok(`Applied ${name}`);
  if (Array.isArray(body) && body.length > 0) {
    console.log('Result rows:', JSON.stringify(body, null, 2));
  }
}

const arg = process.argv[2];
const file = await resolveMigrationFile(arg);
await applyMigration(file);
