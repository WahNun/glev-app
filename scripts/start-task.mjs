#!/usr/bin/env node
/**
 * scripts/start-task.mjs
 *
 * Runs at the start of every Replit agent task:
 *   1. Sends a "starting" Telegram notification (so Lucas has a message to reply to)
 *   2. Checks the inbox for any context Lucas already queued for this task
 *   3. Prints inbox messages to stdout as JSON lines for the agent to consume
 *
 * Usage:
 *   node scripts/start-task.mjs <TASK_GID> "<task name>"
 *
 * Output:
 *   Inbox messages (if any) as JSON lines: {"id":"...","message":"...","created_at":"..."}
 *   SKIPPED  — if secrets are missing
 */

import { createClient } from '@supabase/supabase-js';

const [, , TASK_ID, TASK_NAME] = process.argv;

if (!TASK_ID) {
  console.error('Usage: node scripts/start-task.mjs <TASK_GID> "<task name>"');
  process.exit(1);
}

const BOT_TOKEN              = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID                = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL           = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [
  !BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
  !CHAT_ID && 'TELEGRAM_CHAT_ID',
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length > 0) {
  console.error(`[start-task] Secrets not configured (${missing.join(', ')}) — skipping.`);
  process.stdout.write('SKIPPED\n');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── 1. Send "starting" notification ──────────────────────────────────────────

const label = TASK_NAME ? `${TASK_NAME} (Task \`${TASK_ID}\`)` : `Task \`${TASK_ID}\``;
const text  = `🚀 *Starting:* ${label}\n\n_Reply here to send me screenshots, voice notes, or extra context for this task._`;

const { error: insertErr } = await supabase
  .from('agent_messages')
  .insert({ task_id: TASK_ID, direction: 'outbound', message: text });

if (insertErr) {
  console.error('[start-task] Failed to insert outbound:', insertErr.message);
}

const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
});

if (!tgRes.ok) {
  console.error('[start-task] Telegram send failed:', await tgRes.text());
}

// ── 2. Flush inbox → print any queued context Lucas sent earlier ─────────────

const { data: inbox, error: inboxErr } = await supabase
  .from('agent_messages')
  .select('id, message, created_at')
  .eq('task_id', 'inbox')
  .eq('direction', 'inbound')
  .order('created_at', { ascending: true });

if (inboxErr) {
  console.error('[start-task] Inbox query failed:', inboxErr.message);
  process.exit(0);
}

if (inbox && inbox.length > 0) {
  for (const row of inbox) {
    process.stdout.write(JSON.stringify({ id: row.id, message: row.message, created_at: row.created_at }) + '\n');
  }

  // Mark inbox messages as consumed
  const ids = inbox.map((r) => r.id);
  await supabase.from('agent_messages').delete().in('id', ids);
}
