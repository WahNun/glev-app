// app/api/telegram/webhook/route.ts
//
// Telegram Bot Webhook — empfängt Updates von Telegram und schreibt
// inbound-Antworten in die `agent_messages`-Tabelle (Message-Bus für den Agent).
//
// ─── Einmalige Setup-Schritte nach Deploy ────────────────────────────────────
//
// 1. Webhook registrieren (einmalig pro Bot / Deployment-URL):
//
//    curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
//      -H "Content-Type: application/json" \
//      -d '{
//        "url": "https://glev.app/api/telegram/webhook",
//        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
//      }'
//
// 2. Vercel Environment Variables setzen (Vercel Dashboard → Project → Settings → Env Vars):
//    - TELEGRAM_BOT_TOKEN       — Bot-Token von @BotFather
//    - TELEGRAM_WEBHOOK_SECRET  — Selbst gewähltes Secret (mind. 32 Zeichen, nur ASCII)
//    - SUPABASE_URL             — Supabase-Projekt-URL
//    - SUPABASE_SERVICE_ROLE_KEY — Service-Role-Key (nicht der anon key!)
//    - OPENAI_API_KEY oder AI_INTEGRATIONS_OPENAI_API_KEY — für Whisper-Transkription
//
// 3. Webhook prüfen:
//    curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
//
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Abuse-Protection Constants ───────────────────────────────────────────────

/** Max voice note duration (seconds) accepted before calling Whisper. */
const VOICE_MAX_DURATION_SECONDS = 60;

/**
 * IP rate-limit: max requests allowed within the sliding window.
 * Telegram sends legitimate retries at ~20 s intervals — 10 req/min is
 * generous enough for normal use and still blocks floods.
 */
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * update_id deduplication cache — bounded to the last N ids so a Telegram
 * retry storm (same update_id resent multiple times) is dropped without a DB
 * round-trip. Module-level: lives for the lifetime of the Node.js worker.
 */
const DEDUP_CACHE_MAX_SIZE = 500;

// ─── Module-level in-memory state ────────────────────────────────────────────

// update_id → insertion order (insertion-order iteration = oldest first).
const seenUpdateIds = new Set<number>();

// IP → list of request timestamps (epoch ms) within the current window.
const ipRequestLog = new Map<string, number[]>();

// ─── Types ───────────────────────────────────────────────────────────────────

interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  reply_to_message?: {
    text?: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// ─── Abuse helpers ────────────────────────────────────────────────────────────

/**
 * Returns true when the update_id has already been processed.
 * Evicts the oldest entry when the cache is full.
 */
function isDuplicate(updateId: number): boolean {
  if (seenUpdateIds.has(updateId)) return true;

  // Evict oldest entry to keep the Set bounded.
  if (seenUpdateIds.size >= DEDUP_CACHE_MAX_SIZE) {
    const oldest = seenUpdateIds.values().next().value;
    if (oldest !== undefined) seenUpdateIds.delete(oldest);
  }

  seenUpdateIds.add(updateId);
  return false;
}

/**
 * Returns true when the IP has exceeded the rate limit.
 * Cleans up expired timestamps on each call.
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = (ipRequestLog.get(ip) ?? []).filter(
    (t) => t > windowStart,
  );

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    ipRequestLog.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  ipRequestLog.set(ip, timestamps);
  return false;
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

function serviceRoleClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

/**
 * Lädt eine Telegram-Datei herunter und gibt sie als Buffer zurück.
 */
async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const infoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
  );
  if (!infoRes.ok) {
    throw new Error(`getFile failed: ${infoRes.status}`);
  }
  const infoJson = (await infoRes.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const filePath = infoJson.result?.file_path;
  if (!filePath) {
    throw new Error("getFile returned no file_path");
  }

  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`File download failed: ${fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const mimeType = fileRes.headers.get("content-type") || "audio/ogg";
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

/**
 * Transkribiert eine Audio-Datei via OpenAI Whisper (whisper-1).
 */
async function transcribeVoice(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const openai = getOpenAIClient();

  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
      ? "mp3"
      : mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("webm")
          ? "webm"
          : "ogg";

  const file = new File([new Uint8Array(buffer)], `voice.${ext}`, { type: mimeType });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });

  return transcription.text ?? "";
}

/**
 * Lädt den Chat-Verlauf aus agent_messages und generiert eine KI-Antwort.
 * Wird nur aufgerufen wenn task_id === "inbox" (freie Nachrichten von Lucas).
 */
async function generateAndSendChatReply(
  userMessage: string,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  // Letzten 20 Nachrichten als Konversations-History laden
  const { data: history } = await supabase
    .from("agent_messages")
    .select("direction, message, created_at")
    .eq("task_id", "inbox")
    .order("created_at", { ascending: false })
    .limit(20);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: `Du bist der Replit-Agent für das Glev-Projekt — eine T1D Insulin Decision Support App (Next.js 15, Supabase, Vercel, Capacitor iOS/Android).
Du chattest mit Lucas, dem Gründer, direkt via Telegram.
Antworte kurz, direkt und auf Deutsch. Du kennst das Projekt in- und auswendig.
Aktuell laufende Aufgabe: Android AAB-Build für Google Play Internal Testing.
Letzter Status: minSdkVersion musste von 24 auf 26 erhöht werden (wegen capgo-capacitor-health). Lucas muss git pull machen oder variables.gradle manuell anpassen, dann Sync Now + Build neu starten.`,
    },
  ];

  // History in chronologischer Reihenfolge einbauen (ohne aktuelle Nachricht)
  if (history && history.length > 1) {
    const ordered = [...history].reverse().slice(0, -1); // älteste zuerst, letzte (aktuelle) weglassen
    for (const row of ordered) {
      messages.push({
        role: row.direction === "inbound" ? "user" : "assistant",
        content: row.message ?? "",
      });
    }
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content ?? "…";

    // Antwort via Telegram senden
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" }),
    });

    // Outbound in agent_messages speichern
    await supabase.from("agent_messages").insert({
      task_id: "inbox",
      direction: "outbound",
      message: reply,
    });
  } catch (err) {
    console.error("[telegram/webhook] Chat reply failed:", err);
  }
}

/**
 * Lädt ein Bild in Supabase Storage hoch und gibt die öffentliche URL zurück.
 * Format im agent_messages-Eintrag: "[file] <url>  <caption>"
 */
async function uploadImageToStorage(
  buffer: Buffer,
  fileId: string,
  caption?: string,
): Promise<string> {
  const url     = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const { createClient: makeClient } = await import("@supabase/supabase-js");
  const sb = makeClient(url, svcKey, { auth: { persistSession: false } });

  const path = `telegram/${Date.now()}_${fileId}.jpg`;
  const { error: uploadErr } = await sb.storage
    .from("agent-files")
    .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = sb.storage.from("agent-files").getPublicUrl(path);
  return caption ? `[file] ${publicUrl}  ${caption}` : `[file] ${publicUrl}`;
}

/**
 * Extrahiert die task_id aus dem Reply-Kontext per Regex.
 * Erwartet das Format "Task <TASK_ID>" irgendwo im Text
 * (z. B. "Agent-Frage (Task: 1234567890):" oder "🤖 Replit-Frage (Task 1234567890)").
 */
export function extractTaskId(replyText: string): string | null {
  const match = replyText.match(/Task[:\s`]+(\d+)/i);
  return match?.[1] ?? null;
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Secret-Token-Prüfung ─────────────────────────────────────────────────
  const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    // eslint-disable-next-line no-console
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  if (!receivedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. IP Rate-Limiting ──────────────────────────────────────────────────────
  // x-forwarded-for is set by Vercel's edge layer; fall back to a sentinel so
  // we never skip the check when the header is absent.
  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(sourceIp)) {
    // eslint-disable-next-line no-console
    console.warn(`[telegram/webhook] Rate limit exceeded for IP ${sourceIp}`);
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  // ── 3. Update parsen ─────────────────────────────────────────────────────────
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 4. update_id Deduplizierung ──────────────────────────────────────────────
  // Telegram resends an update if the webhook doesn't respond with 2xx within
  // the timeout. Identical update_ids are silently acknowledged.
  if (isDuplicate(update.update_id)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[telegram/webhook] Duplicate update_id ${update.update_id} — skipped`,
    );
    return NextResponse.json({ ok: true });
  }

  // ── 5. Message extrahieren ───────────────────────────────────────────────────
  const message = update.message;
  if (!message) {
    // Andere Update-Typen (edited_message, inline_query, …) ignorieren
    return NextResponse.json({ ok: true });
  }

  // ── 6. task_id ermitteln ──────────────────────────────────────────────────────
  // Priorität:
  //   1. reply_to_message.text  — expliziter Reply auf eine Agent-Frage
  //   2. caption                — Bild/Datei mit "Task 123" im Caption
  //   3. message.text itself    — freie Nachricht mit "Task 123" im Text
  //   4. most recent pending outbound — freie Antwort ohne Reply-Kontext
  //   5. "inbox"                — vom Agenten unaufgeforderte Nachricht von Lucas
  const replyText  = message.reply_to_message?.text ?? "";
  const captionText = message.caption ?? "";
  const msgText    = message.text ?? "";

  let taskId =
    extractTaskId(replyText) ??
    extractTaskId(captionText) ??
    extractTaskId(msgText);

  if (!taskId) {
    // Kein expliziter Task-Kontext — suche das jüngste offene Outbound
    // (d. h. eine Frage des Agenten, auf die noch keine inbound-Antwort kam).
    const supabase = serviceRoleClient();
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: pending } = await supabase
      .from("agent_messages")
      .select("task_id, created_at")
      .eq("direction", "outbound")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pending) {
      // Prüfen ob für diesen Task schon eine inbound-Antwort existiert
      const { data: alreadyAnswered } = await supabase
        .from("agent_messages")
        .select("id")
        .eq("direction", "inbound")
        .eq("task_id", pending.task_id)
        .gte("created_at", pending.created_at)
        .limit(1)
        .maybeSingle();

      if (!alreadyAnswered) {
        taskId = pending.task_id;
      }
    }

    // Immer noch keine Task-ID → Lucas hat proaktiv geschrieben → Inbox
    if (!taskId) {
      taskId = "inbox";
    }
  }

  // ── 7. Nachrichtentext ermitteln (Text, Screenshot oder Voice-Transkript) ──────
  let inboundText: string | null = null;

  if (message.photo) {
    // Telegram sendet mehrere Größen — die letzte ist die höchste Auflösung
    const largest = message.photo[message.photo.length - 1];
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN is not set");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }
    try {
      const { buffer } = await downloadTelegramFile(botToken, largest.file_id);
      inboundText = await uploadImageToStorage(buffer, largest.file_id, captionText || undefined);
    } catch (err) {
      console.error("[telegram/webhook] Image upload failed:", err);
      return NextResponse.json({ error: "Image upload failed" }, { status: 500 });
    }
  } else if (message.document) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN is not set");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }
    const doc = message.document;
    const mimeType = doc.mime_type ?? "application/octet-stream";
    const fileName = doc.file_name ?? `file_${Date.now()}`;
    const ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
    try {
      const { buffer } = await downloadTelegramFile(botToken, doc.file_id);
      const url     = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      const { createClient: makeClient } = await import("@supabase/supabase-js");
      const sb = makeClient(url, svcKey, { auth: { persistSession: false } });
      const storagePath = `telegram/${Date.now()}_${doc.file_id}.${ext}`;
      const { error: uploadErr } = await sb.storage
        .from("agent-files")
        .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);
      const { data: { publicUrl } } = sb.storage.from("agent-files").getPublicUrl(storagePath);
      const label = captionText ? `${fileName}  ${captionText}` : fileName;
      inboundText = `[file] ${publicUrl}  ${label}`;
    } catch (err) {
      console.error("[telegram/webhook] Document upload failed:", err);
      return NextResponse.json({ error: "Document upload failed" }, { status: 500 });
    }
  } else if (message.text) {
    inboundText = message.text;
  } else if (message.voice) {
    // Guard: reject overlong voice notes before touching Whisper.
    if (message.voice.duration > VOICE_MAX_DURATION_SECONDS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[telegram/webhook] Voice note too long (${message.voice.duration}s > ${VOICE_MAX_DURATION_SECONDS}s) — rejected`,
      );
      return NextResponse.json(
        { error: "Voice note too long" },
        { status: 413 },
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      // eslint-disable-next-line no-console
      console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN is not set");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 },
      );
    }

    try {
      const { buffer, mimeType } = await downloadTelegramFile(
        botToken,
        message.voice.file_id,
      );
      inboundText = await transcribeVoice(buffer, mimeType);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[telegram/webhook] Voice transcription failed:", err);
      return NextResponse.json(
        { error: "Transcription failed" },
        { status: 500 },
      );
    }
  }

  if (!inboundText) {
    // Weder Text noch Voice — ignorieren
    return NextResponse.json({ ok: true });
  }

  // ── 8. inbound-Zeile in agent_messages schreiben ──────────────────────────────
  try {
    const supabase = serviceRoleClient(); // cheap — cached after first call in step 6
    const { error } = await supabase.from("agent_messages").insert({
      task_id: taskId,
      direction: "inbound",
      message: inboundText,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[telegram/webhook] Supabase insert failed:",
        error.message,
      );
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram/webhook] Unexpected DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // ── 9. KI-Antwort für freie Inbox-Nachrichten ────────────────────────────────
  // Nur wenn Lucas frei schreibt (nicht als Reply auf eine Task-Frage).
  // Fire-and-forget: Telegram bekommt sofort 200 OK, Antwort kommt asynchron.
  if (taskId === "inbox" && inboundText && !inboundText.startsWith("[file]")) {
    const supabase = serviceRoleClient();
    generateAndSendChatReply(inboundText, supabase).catch((err) =>
      console.error("[telegram/webhook] generateAndSendChatReply failed:", err),
    );
  }

  return NextResponse.json({ ok: true });
}
