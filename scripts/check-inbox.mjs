#!/usr/bin/env node
/**
 * scripts/check-inbox.mjs
 *
 * Liest unverarbeitete Nachrichten, die Lucas proaktiv per Telegram
 * geschickt hat (task_id = "inbox"), und gibt sie als JSON-Lines aus.
 * Der Agent ruft dieses Skript am Anfang jedes Task-Zyklus auf.
 *
 * Usage:
 *   node scripts/check-inbox.mjs [--since <ISO-timestamp>]
 *   node scripts/check-inbox.mjs --mark-read   # löscht verarbeitete Inbox-Zeilen
 *
 * Output (eine JSON-Zeile pro Nachricht):
 *   {"id":"...","message":"...","created_at":"..."}
 *
 * Exit codes:
 *   0 — immer (keine Nachrichten → kein Output)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[check-inbox] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(0); // graceful — don't crash the agent loop
}

const args      = process.argv.slice(2);
const sinceIdx  = args.indexOf('--since');
const markRead  = args.includes('--mark-read');
const since     = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let query = supabase
  .from('agent_messages')
  .select('id, message, created_at')
  .eq('task_id', 'inbox')
  .eq('direction', 'inbound')
  .order('created_at', { ascending: true });

if (since) {
  query = query.gt('created_at', since);
}

const { data, error } = await query;

if (error) {
  console.error('[check-inbox] Supabase error:', error.message);
  process.exit(0);
}

if (!data || data.length === 0) {
  process.exit(0);
}

for (const row of data) {
  process.stdout.write(JSON.stringify({ id: row.id, message: row.message, created_at: row.created_at }) + '\n');
}

// Optionally delete processed inbox rows so they don't appear again
if (markRead && data.length > 0) {
  const ids = data.map((r) => r.id);
  const { error: delErr } = await supabase
    .from('agent_messages')
    .delete()
    .in('id', ids);
  if (delErr) {
    console.error('[check-inbox] Failed to delete processed rows:', delErr.message);
  }
}
