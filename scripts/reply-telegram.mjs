#!/usr/bin/env node
/**
 * scripts/reply-telegram.mjs
 *
 * Fire-and-forget: sendet eine Nachricht an Lucas per Telegram und beendet sich.
 * Kein Warten auf Antwort — dafür ask-telegram.mjs verwenden.
 *
 * Usage:
 *   node scripts/reply-telegram.mjs "Nachricht an Lucas"
 *   node scripts/reply-telegram.mjs <TASK_GID> "Nachricht"   ← loggt auch in agent_messages
 *
 * Exit codes:
 *   0 — immer (SKIPPED wenn Secrets fehlen)
 */

import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/reply-telegram.mjs ["<message>"] or [<TASK_GID> "<message>"]');
  process.exit(1);
}

// Detect: reply-telegram.mjs <GID> "<msg>"  vs  reply-telegram.mjs "<msg>"
const hasTaskId = args.length >= 2 && /^\d{10,}$/.test(args[0]);
const TASK_ID   = hasTaskId ? args[0] : null;
const MESSAGE   = hasTaskId ? args.slice(1).join(' ') : args.join(' ');

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[reply-telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — skipping.');
  process.stdout.write('SKIPPED\n');
  process.exit(0);
}

// Send message
const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: CHAT_ID, text: MESSAGE, parse_mode: 'Markdown' }),
});

if (!res.ok) {
  console.error('[reply-telegram] Telegram send failed:', await res.text());
  process.exit(1);
}

// Optionally log outbound to agent_messages for traceability
if (TASK_ID && SB_URL && SB_KEY) {
  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  await supabase.from('agent_messages').insert({
    task_id: TASK_ID,
    direction: 'outbound',
    message: MESSAGE,
  });
}

process.exit(0);
