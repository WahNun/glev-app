// TODO: consolidate with /api/transcribe/mistral after engine-stt-migration verified — separate sprint
import { NextRequest } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { errorResponse } from "@/lib/api/errorResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_AUDIO_BYTES = 1500;

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

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return errorResponse("UPSTREAM_ERROR", 400);
    }
    const tForm = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] formData parse:", tForm - t0, "ms · audio:", Math.round(file.size / 1024), "KB ·", file.type);

    if (file.size < MIN_AUDIO_BYTES) {
      // eslint-disable-next-line no-console
      console.warn("[transcribe] audio blob too small:", file.size, "bytes — rejecting");
      return errorResponse("UPSTREAM_ERROR", 400);
    }

    let mistral;
    try { mistral = getMistralClient(); }
    catch { return errorResponse("UPSTREAM_ERROR", 503); }

    const tInit = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] mistral init:", tInit - tForm, "ms");

    const result = await mistral.audio.transcriptions.complete({
      model: "voxtral-mini-latest",
      file: file as Blob,
    });

    const text = (result as unknown as { text?: string }).text ?? "";

    const tDone = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] Voxtral call:", tDone - tInit, "ms · text len:", text.length, "chars · total:", tDone - t0, "ms");

    return Response.json({ text });
  } catch (err: unknown) {
    const tErr = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] FAILED after:", tErr - t0, "ms");
    if (isMistral429(err)) {
      const retry_after_sec = getRetryAfterSec(err);
      // eslint-disable-next-line no-console
      console.warn("[transcribe] Mistral rate limit:", retry_after_sec, "s");
      return errorResponse("MISTRAL_RATE_LIMITED", 429, { retry_after_sec });
    }
    const msg = err instanceof Error ? err.message : "Transcription failed";
    // eslint-disable-next-line no-console
    console.error("[transcribe] unexpected error:", msg);
    return errorResponse("UPSTREAM_ERROR", 500);
  }
}
