import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

const TTS_VOICE = "en_paul_neutral";
const TTS_MODEL = "voxtral-mini-tts-latest";

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

  const voice =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).voice === "string"
      ? (raw as { voice: string }).voice
      : TTS_VOICE;

  const upstream = await fetch("https://api.mistral.ai/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: TTS_MODEL, input: text, voice }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Mistral TTS error: ${upstream.status}`, detail: errText },
      { status: 502 },
    );
  }

  const audioBuffer = await upstream.arrayBuffer();
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
