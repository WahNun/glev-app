import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }
    const tForm = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] formData parse:", tForm - t0, "ms · audio:", Math.round(file.size / 1024), "KB ·", file.type);

    let openai;
    try { openai = getOpenAIClient(); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }

    const tInit = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] openai init:", tInit - tForm, "ms");

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    const tDone = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] Whisper call:", tDone - tInit, "ms · text len:", (transcription.text ?? "").length, "chars · total:", tDone - t0, "ms");

    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (err: unknown) {
    const tErr = Date.now();
    // eslint-disable-next-line no-console
    console.log("[PERF transcribe] FAILED after:", tErr - t0, "ms");
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
