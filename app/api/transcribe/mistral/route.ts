import { NextRequest, NextResponse } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }

    // eslint-disable-next-line no-console
    console.log("[STT mistral] audio received:", Math.round(file.size / 1024), "KB ·", file.type);

    let mistral;
    try { mistral = getMistralClient(); }
    catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "AI not configured" },
        { status: 503 },
      );
    }

    const t1 = Date.now();

    const result = await mistral.audio.transcriptions.complete({
      model: "voxtral-mini",
      file: file as Blob,
    });

    const text = (result as unknown as { text?: string }).text ?? "";

    // eslint-disable-next-line no-console
    console.log("[STT mistral] done in", Date.now() - t1, "ms · chars:", text.length, "· total:", Date.now() - t0, "ms");

    return NextResponse.json({ text });
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.log("[STT mistral] FAILED after", Date.now() - t0, "ms:", err instanceof Error ? err.message : err);
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
