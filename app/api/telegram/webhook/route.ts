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

// ─── Types ───────────────────────────────────────────────────────────────────

interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  voice?: TelegramVoice;
  reply_to_message?: {
    text?: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

  // Node.js File-Objekt aus Buffer erzeugen
  const ext = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
      ? "mp3"
      : mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("webm")
          ? "webm"
          : "ogg";

  const file = new File([buffer], `voice.${ext}`, { type: mimeType });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });

  return transcription.text ?? "";
}

/**
 * Extrahiert die task_id aus dem Reply-Kontext per Regex.
 * Erwartet das Format "Task <TASK_ID>" irgendwo im Text
 * (z. B. "Agent-Frage (Task: 1234567890):" oder "🤖 Replit-Frage (Task 1234567890)").
 */
function extractTaskId(replyText: string): string | null {
  const match = replyText.match(/Task[:\s]+(\d+)/i);
  return match?.[1] ?? null;
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Secret-Token-Prüfung
  const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    // eslint-disable-next-line no-console
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (!receivedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Update parsen
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = update.message;
  if (!message) {
    // Andere Update-Typen (edited_message, inline_query, …) ignorieren
    return NextResponse.json({ ok: true });
  }

  // 3. task_id aus dem Reply-Kontext extrahieren
  const replyText = message.reply_to_message?.text ?? "";
  if (!replyText) {
    // Keine Antwort auf eine Agent-Nachricht — ignorieren
    return NextResponse.json({ ok: true });
  }

  const taskId = extractTaskId(replyText);
  if (!taskId) {
    // Reply bezieht sich nicht auf eine Agent-Frage — ignorieren
    return NextResponse.json({ ok: true });
  }

  // 4. Nachrichtentext ermitteln (Text oder Voice-Transkript)
  let inboundText: string | null = null;

  if (message.text) {
    inboundText = message.text;
  } else if (message.voice) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      // eslint-disable-next-line no-console
      console.error("[telegram/webhook] TELEGRAM_BOT_TOKEN is not set");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
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
      return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
    }
  }

  if (!inboundText) {
    // Weder Text noch Voice — ignorieren
    return NextResponse.json({ ok: true });
  }

  // 5. inbound-Zeile in agent_messages schreiben
  try {
    const supabase = serviceRoleClient();
    const { error } = await supabase.from("agent_messages").insert({
      task_id: taskId,
      direction: "inbound",
      message: inboundText,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error("[telegram/webhook] Supabase insert failed:", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[telegram/webhook] Unexpected DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
