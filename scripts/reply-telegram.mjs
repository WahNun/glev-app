#!/usr/bin/env node
/**
 * scripts/reply-telegram.mjs
 *
 * Sendet eine Antwort-Nachricht an Lucas per Telegram — ohne auf eine
 * Antwort zu warten (fire-and-forget).
 *
 * Usage:
 *   node scripts/reply-telegram.mjs "<message>"
 *   node scripts/reply-telegram.mjs <TASK_GID> "<message>"   # speichert auch in agent_messages
 *
 * Required Secrets:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);

let TASK_ID = null;
let MESSAGE = null;

if (args.length === 1) {
  MESSAGE = args[0];
} else if (args.length >= 2) {
  TASK_ID = args[0];
  MESSAGE = args[1];
} else {
  console.error('Usage: node scripts/reply-telegram.mjs [TASK_GID] "<message>"');
  process.exit(1);
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[reply-telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping.');
  process.exit(0);
}

// Optionally persist outbound to agent_messages
if (TASK_ID) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SB_URL && SB_KEY) {
    const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    await supabase.from('agent_messages').insert({
      task_id: TASK_ID,
      direction: 'outbound',
      message: MESSAGE,
    });
  }
}

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: CHAT_ID, text: MESSAGE, parse_mode: 'Markdown' }),
});

if (!res.ok) {
  const body = await res.text().catch(() => '');
  console.error(`[reply-telegram] Telegram send failed (${res.status}): ${body}`);
  process.exit(1);
}

console.log('[reply-telegram] sent');
