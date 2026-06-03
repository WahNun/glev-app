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

  // Voxtral TTS is LLM-based and responds to speaking-style instructions
  // prepended to the input — same technique used in Mistral Studio.
  // A single fixed style prefix is used for all speed settings; actual speed is
  // controlled client-side via HTMLAudioElement.playbackRate in useTTS.ts
  // (slow → 0.75, normal → 1.0, fast → 1.3). Tempo hints in the prompt were
  // tested (2026-06-02) and produced no reliable audible difference in speaking
  // rate — Voxtral's neural vocoder does not respond predictably to text-based
  // pace instructions, while playbackRate works precisely on all platforms.
  //
  // Style prefix is editable via /glev-ops/mistral (stored in admin_tts_config.style_prefix).
  // Falls back to the hardcoded default when the DB value is absent or empty.
  const DEFAULT_STYLE_PREFIX =
    "Sprich warm, ruhig und natürlich — wie ein vertrauter Assistent beim Gespräch unter vier Augen. Keine übertriebene Betonung, keine Pausen zwischen Wörtern, fließend und menschlich.";
  const stylePrefix = dbStylePrefix?.trim() || DEFAULT_STYLE_PREFIX;
  // When a voice-clone ref_audio is active, skip the style prefix:
  // the sample already encodes speaking style and tone. Prepending a text
  // instruction fights the voice-cloning layer and produces robotic output.
  const useStylePrefix = !refAudio && !skipStylePrefix;
  const styledInput = useStylePrefix ? `${stylePrefix}\n\n${text}` : text;

  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input: styledInput,
    response_format: "mp3",
    speed: speedFloat,
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
