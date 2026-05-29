import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Voxtral TTS model — matches what Mistral Studio uses.
// Override via MISTRAL_TTS_MODEL env var if Mistral ships a newer model.
const TTS_MODEL = process.env.MISTRAL_TTS_MODEL ?? "voxtral-mini-tts-2603";

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

  // Load central voice config from admin_tts_config (service-role, fire-and-forget).
  // Priority: ref_audio (admin upload) > voice_id (DB) > env var > Mistral default.
  let refAudio: string | null = null;
  let dbVoiceId: string | null = null;
  try {
    const sb = getSupabaseAdmin();
    const { data: cfg } = await sb
      .from("admin_tts_config")
      .select("ref_audio, voice_id")
      .eq("id", "singleton")
      .maybeSingle();
    refAudio = cfg?.ref_audio ?? null;
    dbVoiceId = cfg?.voice_id ?? null;
  } catch {
    // Table may not exist yet in dev — fall back to env var below.
  }

  const voiceId = dbVoiceId ?? process.env.MISTRAL_TTS_VOICE_ID ?? "Jane";

  // Voxtral TTS is LLM-based and responds to speaking-style instructions
  // prepended to the input — same technique used in Mistral Studio.
  // This makes output warmer and more conversational rather than flat/robotic.
  const styledInput = `Sprich warm, ruhig und natürlich — wie ein vertrauter Assistent beim Gespräch unter vier Augen. Keine übertriebene Betonung, keine Pausen zwischen Wörtern, fließend und menschlich.\n\n${text}`;

  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input: styledInput,
    response_format: "mp3",
    ...(refAudio ? { ref_audio: refAudio } : { voice_id: voiceId }),
  };

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
