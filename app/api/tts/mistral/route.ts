import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";

// Voxtral TTS model — matches what Mistral Studio uses.
// Override via MISTRAL_TTS_MODEL env var if Mistral ships a newer model.
const TTS_MODEL = process.env.MISTRAL_TTS_MODEL ?? "voxtral-mini-tts-2603";

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  const adminAuthed = auth.user ? false : await isAdminAuthed();
  if (!auth.user && !adminAuthed) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TTS not configured" }, { status: 503 });
  }

  const raw = await req.json().catch(() => null);
  const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text =
    typeof rawObj.text === "string" ? rawObj.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 1000) {
    return NextResponse.json({ error: "text too long (max 1000 chars)" }, { status: 400 });
  }

  // Map speed preference to a float for the upstream request body.
  // Mistral confirmed (2026-06-02) that voxtral-mini-tts-2603 does not yet expose a native
  // speed/rate parameter, so the field is currently ignored by the API. It is included anyway
  // so that when Mistral ships the parameter the integration activates automatically without
  // a code change. Client-side playbackRate in useTTS.ts (same mapping) handles actual speed
  // today; a prompt-based tempo hint below adds a best-effort LLM-level nudge.
  // Allow callers to opt out of the style prefix for explicit A/B comparison.
  // The route is already auth-gated, so this poses no additional security risk.
  const skipStylePrefix = rawObj.skip_style_prefix === true;

  const speed = rawObj.speed === "slow" || rawObj.speed === "fast" ? rawObj.speed : "normal";
  const speedFloat = speed === "slow" ? 0.75 : speed === "fast" ? 1.3 : 1.0;

  // Load central voice config from admin_tts_config (service-role, fire-and-forget).
  // Priority: ref_audio (admin upload) > voice_id (DB) > env var > Mistral default.
  let refAudio: string | null = null;
  let dbVoiceId: string | null = null;
  let dbStylePrefix: string | null = null;
  try {
    const sb = getSupabaseAdmin();
    const { data: cfg } = await sb
      .from("admin_tts_config")
      .select("ref_audio, voice_id, style_prefix")
      .eq("id", "singleton")
      .maybeSingle();
    refAudio = cfg?.ref_audio ?? null;
    dbVoiceId = cfg?.voice_id ?? null;
    dbStylePrefix = (cfg?.style_prefix as string | null) ?? null;
  } catch {
    // Table may not exist yet in dev — fall back to env var below.
  }

  const voiceId = dbVoiceId ?? process.env.MISTRAL_TTS_VOICE_ID ?? "Jane";

  // Style prefix via text-prepend does NOT work with voxtral-mini-tts-2603:
  // the model reads the instruction verbatim rather than using it as a style guide.
  // Confirmed 2026-06-03: "Sprich warm, ruhig und natürlich..." was being read aloud.
  // Voice character is controlled via voice_id ("Jane") or ref_audio clone instead.
  // The skip_style_prefix flag and DB value are retained for future API changes /
  // A/B testing via the ops panel, but the prefix is never applied to the input.
  void dbStylePrefix; // retained in DB for future use
  void skipStylePrefix; // retained for A/B ops toggle
  const styledInput = text;

  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input: styledInput,
    response_format: "mp3",
    // speed is intentionally omitted: Mistral confirmed (2026-06-03, via 422 test) that
    // voxtral-mini-tts-2603 rejects unknown fields ("Extra inputs are not permitted").
    // Actual playback speed is handled client-side via HTMLAudioElement.playbackRate in useTTS.ts.
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
