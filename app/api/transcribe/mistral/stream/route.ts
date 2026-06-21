import { NextRequest } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";
import { isSTTRateLimited, addSTTRateLimitHit, STT_MIN_BLOB_BYTES } from "@/lib/ai/sttRateLimiter";
import { isWebm, convertWebmToWav } from "@/lib/ai/audioConverter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Map browser MIME type → filename with extension Voxtral understands. */
function voxtralFileName(mimeType: string): string {
  if (mimeType.startsWith("audio/mp4") || mimeType.startsWith("audio/m4a")) return "audio.m4a";
  if (mimeType.startsWith("audio/mpeg") || mimeType.startsWith("audio/mp3")) return "audio.mp3";
  if (mimeType.startsWith("audio/ogg")) return "audio.ogg";
  if (mimeType.startsWith("audio/wav")) return "audio.wav";
  return "audio.webm"; // default — covers audio/webm;codecs=opus (Chrome/Safari/Firefox)
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

  // Voxtral cannot decode WebM/Opus (error 3310). Convert to WAV before streaming.
  let audioBlob: Blob = file;
  let audioMime: string = file.type;
  if (isWebm(file.type)) {
    try {
      const converted = await convertWebmToWav(file);
      audioBlob = new Blob([converted.buffer], { type: converted.mimeType });
      audioMime = converted.mimeType;
    } catch (convErr) {
      // eslint-disable-next-line no-console
      console.log("[STT stream] format_conversion FAILED:", convErr instanceof Error ? convErr.message : convErr);
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "Audio-Konversion fehlgeschlagen. Bitte nochmal versuchen." })}\n\n`,
        { status: 500, headers: { "Content-Type": "text/event-stream" } },
      );
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const t1 = Date.now();

        const audioFile = new File([audioBlob], voxtralFileName(audioMime), { type: audioMime });

        const eventStream = await mistral.audio.transcriptions.stream({
          model: "voxtral-mini-latest",
          file: audioFile,
        });

        await processTranscriptionStream(eventStream, sendEvent);
        // eslint-disable-next-line no-console
        console.log("[STT stream] done · total:", Date.now() - t0, "ms");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log("[STT stream] FAILED after", Date.now() - t0, "ms:", e instanceof Error ? e.message : e);
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
