import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

// Correct model name per Mistral docs (as of March 2026).
const TTS_MODEL = "voxtral-mini-tts-2603";

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 503 });
  }

  const raw = await req.json().catch(() => null);
  const text =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).text === "string"
      ? ((raw as { text: string }).text as string).trim()
      : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 1000) {
    return NextResponse.json({ error: "text too long (max 1000 chars)" }, { status: 400 });
  }

  // Build request body. voice_id is optional — if not configured the model
  // uses its own default voice. Set MISTRAL_TTS_VOICE_ID in env to pin a
  // specific saved voice (e.g. a German voice created via the Voices API).
  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input: text,
    response_format: "mp3",
  };
  const voiceId = process.env.MISTRAL_TTS_VOICE_ID;
  if (voiceId) body.voice_id = voiceId;

  const upstream = await fetch("https://api.mistral.ai/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Mistral TTS error: ${upstream.status}`, detail: errText },
      { status: 502 },
    );
  }

  // The API returns JSON: { audio_data: "<base64-encoded mp3>" }
  const json = await upstream.json().catch(() => null);
  const audioBase64 = json?.audio_data as string | undefined;
  if (!audioBase64) {
    return NextResponse.json({ error: "no audio_data in Mistral response" }, { status: 502 });
  }

  const audioBytes = Buffer.from(audioBase64, "base64");
  return new NextResponse(audioBytes, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
