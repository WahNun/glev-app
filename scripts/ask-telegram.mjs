#!/usr/bin/env node
/**
 * scripts/ask-telegram.mjs
 *
 * Asks Lucas a clarifying question via Telegram and returns the answer
 * synchronously to stdout. Wraps notify-telegram.mjs with clearer formatting.
 *
 * Usage (direct):
 *   node scripts/ask-telegram.mjs <TASK_GID> "<question>" [option1] [option2] ...
 *   pnpm telegram:ask <TASK_GID> "<question>"
 *
 * With numbered options:
 *   node scripts/ask-telegram.mjs 435 "Which approach?" "Option A" "Option B"
 *
 * Exit codes:
 *   0 — always. Prints answer text to stdout, or "TIMEOUT" if no reply in 10 min,
 *       or "SKIPPED" if Telegram secrets are not configured.
 *
 * Integration in finalize-task.sh:
 *   bash scripts/finalize-task.sh TASK_GID --ask "Soll ich X oder Y machen?"
 *
 * Required secrets (Replit only — not needed in Vercel):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Argument-Parsing ────────────────────────────────────────────────────────

const [, , TASK_ID, QUESTION, ...OPTIONS] = process.argv;

if (!TASK_ID || !QUESTION) {
  console.error(
    'Usage: node scripts/ask-telegram.mjs <TASK_ID> "<question>" [option1] [option2] ...',
  );
  process.exit(1);
}

// ─── Graceful degradation when secrets are missing ──────────────────────────

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
  console.error(
    `[ask-telegram] Secrets not configured (${missing.join(', ')}). Skipping Telegram question.`,
  );
  console.error(
    '[ask-telegram] Add them to Replit Secrets to enable async Q&A with Lucas.',
  );
  process.stdout.write('SKIPPED\n');
  process.exit(0);
}

// ─── Supabase Client ─────────────────────────────────────────────────────────

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

function buildMessageText() {
  const header = `❓ *Agent-Frage* (Task \`${TASK_ID}\`)`;
  const body = `\n\n${QUESTION}`;

  let options = '';
  if (OPTIONS.length > 0) {
    options =
      '\n\n' +
      OPTIONS.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n');
  }

  const footer =
    '\n\n_Antworte direkt auf diese Nachricht — der Agent wartet bis zu 10 Minuten._';

  return header + body + options + footer;
}

function finish(answer) {
  process.stdout.write(answer + '\n');
  process.exit(0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const sentAt = new Date().toISOString();

  // 1. Write outbound row to agent_messages
  const { error: insertError } = await supabase
    .from('agent_messages')
    .insert({ task_id: TASK_ID, direction: 'outbound', message: QUESTION });

  if (insertError) {
    console.error('[ask-telegram] Failed to insert outbound message:', insertError.message);
    process.exit(1);
  }

  // 2. Send formatted Telegram message
  await sendTelegramMessage(buildMessageText());
  console.error(`[ask-telegram] Question sent for task ${TASK_ID}. Waiting for reply...`);

  // 3. Wait for inbound reply via Supabase Realtime
  let resolved = false;

  const channel = supabase
    .channel(`ask_telegram:${TASK_ID}:${sentAt}`)
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
        if (row.direction === 'inbound' && row.created_at >= sentAt && !resolved) {
          resolved = true;
          channel.unsubscribe();
          console.error(`[ask-telegram] Answer received: ${row.message}`);
          finish(row.message);
        }
      },
    )
    .subscribe();

  // 4. Safety timeout: output TIMEOUT after 10 minutes
  setTimeout(() => {
    if (!resolved) {
      resolved = true;
      channel.unsubscribe();
      console.error('[ask-telegram] No reply within 10 minutes — outputting TIMEOUT.');
      finish('TIMEOUT');
    }
  }, TIMEOUT_MS);
}

main().catch((err) => {
  console.error('[ask-telegram]', err?.stack || err?.message || String(err));
  process.exit(1);
});
