import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@/lib/ai/openaiClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }
    let openai;
    try { openai = getOpenAIClient(); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "AI not configured" }, { status: 503 }); }
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });
    return NextResponse.json({ text: transcription.text ?? "" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
