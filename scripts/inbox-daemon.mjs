#!/usr/bin/env node
/**
 * scripts/inbox-daemon.mjs
 *
 * Läuft als eigener Replit-Workflow 24/7.
 * Hört per Supabase Realtime auf neue Inbox-Nachrichten (task_id = "inbox")
 * und sendet sofort eine Telegram-Bestätigung, damit Lucas weiß, dass seine
 * Nachricht angekommen ist. Der Agent liest die Nachrichten beim nächsten Start
 * über scripts/check-inbox.mjs.
 *
 * Replit-Workflow einrichten:
 *   Name:    inbox-daemon
 *   Command: node scripts/inbox-daemon.mjs
 *
 * Required Secrets (Replit):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const SB_URL    = process.env.SUPABASE_URL;
const SB_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [
  !BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
  !CHAT_ID   && 'TELEGRAM_CHAT_ID',
  !SB_URL    && 'SUPABASE_URL',
  !SB_KEY    && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length > 0) {
  console.error(`[inbox-daemon] Missing secrets: ${missing.join(', ')}`);
  process.exit(1);
}

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function ack(message) {
  const preview = message.length > 80 ? message.slice(0, 80) + '…' : message;
  const isFile  = message.startsWith('[file]');
  const text    = isFile
    ? `✅ Screenshot erhalten — ich schaue es mir beim nächsten Task an.`
    : `✅ Verstanden: _"${preview}"_\n\nIch nehme es beim nächsten Task auf.`;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  }).catch((err) => console.error('[inbox-daemon] Telegram ack failed:', err));
}

console.log('[inbox-daemon] Started — watching agent_messages inbox via Supabase Realtime...');

const channel = supabase
  .channel('inbox-daemon')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'agent_messages' },
    async (payload) => {
      const row = payload.new;
      if (row.direction !== 'inbound' || row.task_id !== 'inbox') return;
      console.log('[inbox-daemon] New inbox message:', (row.message ?? '').slice(0, 80));
      await ack(row.message ?? '');
    },
  )
  .subscribe((status, err) => {
    if (err) console.error('[inbox-daemon] Realtime error:', err);
    else console.log('[inbox-daemon] Realtime status:', status);
  });

// Keep the process alive — Replit workflow handles restarts
process.on('SIGINT',  () => { channel.unsubscribe(); process.exit(0); });
process.on('SIGTERM', () => { channel.unsubscribe(); process.exit(0); });
