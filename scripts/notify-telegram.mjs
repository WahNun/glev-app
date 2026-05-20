#!/usr/bin/env node
/**
 * scripts/notify-telegram.mjs
 *
 * Sendet eine Frage per Telegram und wartet synchron auf die Antwort.
 * Nutzt Supabase als Message-Bus: schreibt eine `outbound`-Zeile und
 * wartet per Realtime-Subscription auf eine `inbound`-Antwort.
 *
 * Required secrets (Replit Secrets — werden NICHT von Vercel benötigt):
 *   TELEGRAM_BOT_TOKEN      — Bot-Token von @BotFather (z. B. "123456:ABC-DEF…")
 *   TELEGRAM_CHAT_ID        — Chat-ID des Empfängers (z. B. "987654321")
 *   SUPABASE_URL            — Supabase-Projekt-URL (z. B. "https://xyz.supabase.co")
 *   SUPABASE_SERVICE_ROLE_KEY — Service-Role-Key (nicht der anon key!)
 *
 * Usage:
 *   ANTWORT=$(node scripts/notify-telegram.mjs "TASK_GID" "Frage?")
 *   pnpm telegram:notify TASK_GID "Frage?"
 *
 * Exit codes:
 *   0 — immer (Antworttext oder "TIMEOUT" wird nach stdout geschrieben)
 *
 * Timeout: 10 Minuten. Danach wird "TIMEOUT" ausgegeben.
 */

import { createClient } from '@supabase/supabase-js';

const TIMEOUT_MS = 10 * 60 * 1000; // 10 Minuten

// ─── Argument-Parsing ────────────────────────────────────────────────────────

const [, , TASK_ID, MESSAGE] = process.argv;

if (!TASK_ID || !MESSAGE) {
  console.error('Usage: node scripts/notify-telegram.mjs <TASK_ID> <MESSAGE>');
  process.exit(1);
}

// ─── Env-Var-Check ───────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [
  !BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
  !CHAT_ID && 'TELEGRAM_CHAT_ID',
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  console.error('Add them to Replit Secrets (not Vercel — production does not need them).');
  process.exit(1);
}

// ─── Supabase Client (Service Role) ─────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
}

function finish(answer) {
  process.stdout.write(answer + '\n');
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const sentAt = new Date().toISOString();

  // 1. Outbound-Eintrag in agent_messages schreiben
  const { error: insertError } = await supabase
    .from('agent_messages')
    .insert({ task_id: TASK_ID, direction: 'outbound', message: MESSAGE });

  if (insertError) {
    console.error('Failed to insert outbound message:', insertError.message);
    process.exit(1);
  }

  // 2. Telegram-Nachricht senden
  const telegramText =
    `*Agent-Frage* (Task: \`${TASK_ID}\`)\n\n${MESSAGE}\n\n` +
    `_Antworte direkt auf diese Nachricht — der Agent wartet bis zu 10 Minuten._`;

  await sendTelegramMessage(telegramText);

  // 3. Realtime-Subscription auf inbound-Antworten für diese task_id
  //    Wir filtern client-seitig auf created_at > sentAt, weil Realtime-Filter
  //    nur einfache Gleichheits-Checks unterstützen.
  let resolved = false;

  const channel = supabase
    .channel(`agent_messages:${TASK_ID}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_messages',
        filter: `task_id=eq.${TASK_ID}`,
      },
      (payload) => {
        const row = payload.new;
        if (
          row.direction === 'inbound' &&
          row.created_at >= sentAt &&
          !resolved
        ) {
          resolved = true;
          channel.unsubscribe();
          finish(row.message);
        }
      },
    )
    .subscribe();

  // 4. Safety-Timeout: nach 10 Minuten TIMEOUT ausgeben
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      channel.unsubscribe();
      finish('TIMEOUT');
    }
  }, TIMEOUT_MS);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
