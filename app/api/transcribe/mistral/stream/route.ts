import { NextRequest } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";
import { isSTTRateLimited, addSTTRateLimitHit, STT_MIN_BLOB_BYTES } from "@/lib/ai/sttRateLimiter";
import { EngineTrace } from "@/lib/engine/trace";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Map browser MIME type → filename with extension Voxtral understands. */
function voxtralFileName(mimeType: string): string {
  if (mimeType.startsWith("audio/mp4") || mimeType.startsWith("audio/m4a")) return "audio.m4a";
  if (mimeType.startsWith("audio/mpeg") || mimeType.startsWith("audio/mp3")) return "audio.mp3";
  if (mimeType.startsWith("audio/ogg")) return "audio.ogg";
  if (mimeType.startsWith("audio/wav")) return "audio.wav";
  return "audio.webm";
}

function isMistral429(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.statusCode === 429 ||
    err.status === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

function getRetryAfterSec(e: unknown): number {
  if (!e || typeof e !== "object") return 5;
  const headers = (e as Record<string, unknown>).headers as Record<string, string> | undefined;
  if (headers) {
    const ra = headers["retry-after"] ?? headers["Retry-After"];
    if (ra) {
      const n = Number(ra);
      if (!isNaN(n) && n > 0) return Math.ceil(n);
      const d = Date.parse(ra);
      if (!isNaN(d)) return Math.max(1, Math.ceil((d - Date.now()) / 1000));
    }
  }
  return 5;
}

/**
 * Pure accumulation logic for the Mistral transcription event stream.
 * Exported for unit-test access — no I/O, no auth, no Mistral client.
 *
 * Rules:
 *   transcription.text.delta → accumulate text, call sendEvent({ type:"partial", text: accumulated })
 *   transcription.done        → call sendEvent({ type:"final", text: data.text ?? accumulated })
 *   After the loop, if nothing was accumulated → sendEvent({ type:"final", text:"" })
 */
export async function processTranscriptionStream(
  eventStream: AsyncIterable<{ data: { type: string; text?: string } }>,
  sendEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  let accumulated = "";

  for await (const chunk of eventStream) {
    const { data } = chunk;

    if (data.type === "transcription.text.delta") {
      accumulated += data.text;
      sendEvent({ type: "partial", text: accumulated });
    } else if (data.type === "transcription.done") {
      const finalText = data.text ?? accumulated;
      sendEvent({ type: "final", text: finalText });
    }
  }

  if (!accumulated) {
    sendEvent({ type: "final", text: "" });
  }
}

/**
 * POST /api/transcribe/mistral/stream
 *
 * SSE streaming speech-to-text via Mistral voxtral-mini.
 *
 * Transport: Server-Sent Events (text/event-stream).
 * Each event is a JSON object with one of:
 *   { type: "partial", text: string }  — intermediate result, emitted per text delta
 *   { type: "final",   text: string }  — complete transcript (transcription.done)
 *   { type: "error",   error: string } — transcription failure
 *
 * Uses mistral.audio.transcriptions.stream() (GA as of SDK v2.2.1).
 * Partial events accumulate deltas so the client always sees the full
 * in-progress text, not just the incremental piece.
 *
 * Auth: requires a valid Supabase session (same gate as all protected routes).
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();

  const auth = await authedClient(req);
  if (!auth.user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Unauthorized" })}\n\n`,
      {
        status: 401,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  let mistral;
  try {
    mistral = getMistralClient();
  } catch (e) {
    const error = e instanceof Error ? e.message : "AI not configured";
    return new Response(
      `data: ${JSON.stringify({ type: "error", error })}\n\n`,
      {
        status: 503,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  // Rate limit check — before parsing the (potentially large) audio blob.
  if (await isSTTRateLimited(auth.user.id)) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Zu viele Anfragen. Bitte kurz warten.", retry_after_sec: 15 })}\n\n`,
      { status: 429, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  let file: Blob;
  let platformMime = "";
  let converted = false;
  let conversionMs: number | undefined;
  let localDecodeValidated = true;
  let fellBackToWav = false;
  let validationMs = 0;
  try {
    const form = await req.formData();
    const raw = form.get("audio");
    if (!(raw instanceof Blob)) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "audio file is required" })}\n\n`,
        {
          status: 400,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    file = raw;
    platformMime         = (form.get("platform_mime") as string | null) ?? file.type;
    converted            = form.get("converted") === "true";
    const cmRaw          = form.get("conversion_ms");
    conversionMs         = cmRaw ? Number(cmRaw) : undefined;
    localDecodeValidated = form.get("local_decode_validated") !== "false";
    fellBackToWav        = form.get("fell_back_to_wav") === "true";
    validationMs         = Number(form.get("validation_ms") ?? 0);
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Failed to parse form data" })}\n\n`,
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  // Reject blobs that are too small to contain real speech.
  if (file.size < STT_MIN_BLOB_BYTES) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Aufnahme zu kurz — bitte nochmal versuchen." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  // Record hit after validating audio (don't count rejected blobs).
  void addSTTRateLimitHit(auth.user.id);

  // eslint-disable-next-line no-console
  console.log("[STT stream] audio received:", Math.round(file.size / 1024), "KB");

  // Strip codec parameter — Voxtral supports WebM natively but rejects
  // "audio/webm;codecs=opus" with error 3310. Bare "audio/webm" is accepted.
  const cleanMime = file.type.split(";")[0];

  let adminSb;
  try { adminSb = getSupabaseAdmin(); } catch { /* no-op */ }
  const traceEnv = adminSb
    ? {
        user_id:     auth.user.id,
        supabase:    adminSb,
        app_version: process.env.npm_package_version ?? "unknown",
        env:         process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      }
    : null;
  const trace = traceEnv
    ? new EngineTrace("voice_intent", {
        platform_mime:          platformMime || file.type,
        upload_mime:            file.type,
        audio_bytes:            file.size,
        converted,
        ...(converted && conversionMs !== undefined ? { conversion_ms: conversionMs } : {}),
        local_decode_validated: localDecodeValidated,
        fell_back_to_wav:       fellBackToWav,
        validation_ms:          validationMs,
      })
    : null;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const t1 = Date.now();

        const audioFile = new File([file], voxtralFileName(cleanMime), { type: cleanMime });

        const eventStream = await mistral.audio.transcriptions.stream({
          model: "voxtral-mini-latest",
          file: audioFile,
        });

        await processTranscriptionStream(eventStream, sendEvent);
        const sttLatency = Date.now() - t1;
        // eslint-disable-next-line no-console
        console.log("[STT stream] done · total:", Date.now() - t0, "ms");
        if (trace && traceEnv) {
          trace.recordStep("voxtral_stt_stream", { success: true, latency_ms: sttLatency, detail: { model: "voxtral-mini-latest" } });
          void trace.persist(traceEnv);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log("[STT stream] FAILED after", Date.now() - t0, "ms:", e instanceof Error ? e.message : e);
        if (trace && traceEnv) {
          trace.setError(e instanceof Error ? e.message : String(e));
          trace.recordStep("voxtral_stt_stream", { success: false, detail: { error: String(e) } });
          void trace.persist(traceEnv);
        }
        if (isMistral429(e)) {
          const retry_after_sec = getRetryAfterSec(e);
          sendEvent({ type: "error", error: "Zu viele Anfragen. Bitte kurz warten.", retry_after_sec });
        } else {
          const error = e instanceof Error ? e.message : "Transcription failed";
          sendEvent({ type: "error", error });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
