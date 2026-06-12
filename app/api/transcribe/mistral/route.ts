import { NextRequest, NextResponse } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";
import { isSTTRateLimited, addSTTRateLimitHit, STT_MIN_BLOB_BYTES } from "@/lib/ai/sttRateLimiter";

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
 * POST /api/transcribe/mistral
 *
 * Server-side speech-to-text via Mistral's voxtral-mini model.
 * Accepts multipart/form-data with an `audio` blob.
 * Returns { text: string }.
 *
 * Auth: requires a valid Supabase session (same gate as all
 * protected API routes). The MISTRAL_API_KEY is reused — no
 * separate STT key needed (see D-018).
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();

  // Auth gate — same pattern as /api/ai/chat and other protected routes
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit check — before any Mistral call.
  if (await isSTTRateLimited(auth.user.id)) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten.", retry_after_sec: 15 },
      { status: 429 },
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }

    // Reject empty / near-empty blobs before sending to Mistral.
    // A blob this small is almost always a mic tap without real speech
    // (OS noise gate ate the signal, or user tapped and immediately released).
    if (file.size < STT_MIN_BLOB_BYTES) {
      return NextResponse.json({ error: "Aufnahme zu kurz — bitte nochmal versuchen." }, { status: 400 });
    }

    // eslint-disable-next-line no-console
    console.log("[STT mistral] audio received:", Math.round(file.size / 1024), "KB ·", file.type);

    // Record hit after validating audio (don't count rejected blobs).
    void addSTTRateLimitHit(auth.user.id);

    let mistral;
    try { mistral = getMistralClient(); }
    catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "AI not configured" },
        { status: 503 },
      );
    }

    const t1 = Date.now();

    // Voxtral identifies the audio format from the file extension.
    // Without a filename the API returns 400 "Audio input could not be decoded."
    const audioFile = new File([file], voxtralFileName(file.type), { type: file.type });

    const result = await mistral.audio.transcriptions.complete({
      model: "voxtral-mini-latest",
      file: audioFile,
    });

    const text = (result as unknown as { text?: string }).text ?? "";

    // eslint-disable-next-line no-console
    console.log("[STT mistral] done in", Date.now() - t1, "ms · chars:", text.length, "· total:", Date.now() - t0, "ms");

    return NextResponse.json({ text });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.log("[STT mistral] FAILED after", Date.now() - t0, "ms:", err instanceof Error ? err.message : err);
    if (isMistral429(err)) {
      const retry_after_sec = getRetryAfterSec(err);
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte kurz warten.", retry_after_sec },
        { status: 429 },
      );
    }
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
