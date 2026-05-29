"use server";

import { isAdminAuthed } from "@/app/admin/buyers/actions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "audio/wav", "audio/x-wav", "audio/wave",
  "audio/mpeg", "audio/mp3",
  "audio/flac", "audio/x-flac",
  "audio/ogg", "audio/opus",
  "audio/pcm",
]);

export interface TtsConfig {
  hasRefAudio: boolean;
  refAudioPreviewB64: string | null; // first 200 kB for in-browser playback
  voiceId: string | null;
  model: string;
  updatedAt: string | null;
}

export async function getTtsConfig(): Promise<TtsConfig | null> {
  if (!(await isAdminAuthed())) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("admin_tts_config")
    .select("ref_audio, voice_id, model, updated_at")
    .eq("id", "singleton")
    .maybeSingle();
  if (!data) return { hasRefAudio: false, refAudioPreviewB64: null, voiceId: null, model: "voxtral-mini-tts-2603", updatedAt: null };
  return {
    hasRefAudio: !!data.ref_audio,
    refAudioPreviewB64: data.ref_audio ? data.ref_audio.slice(0, 200_000) : null,
    voiceId: data.voice_id ?? null,
    model: data.model ?? "voxtral-mini-tts-2603",
    updatedAt: data.updated_at ?? null,
  };
}

export async function uploadRefAudio(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };

  const file = formData.get("audio") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "Keine Datei ausgewählt." };
  if (!ALLOWED_MIME.has(file.type) && !file.name.match(/\.(wav|mp3|flac|opus|ogg|pcm)$/i)) {
    return { ok: false, error: "Ungültiges Format. Erlaubt: wav, mp3, flac, opus, ogg, pcm." };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: `Datei zu groß (max 5 MB, diese: ${(file.size / 1024 / 1024).toFixed(1)} MB).` };

  const buf = await file.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("admin_tts_config").upsert(
    { id: "singleton", ref_audio: b64, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteRefAudio(): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("admin_tts_config").upsert(
    { id: "singleton", ref_audio: null, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function testTts(text: string): Promise<{ ok: boolean; audioB64?: string; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };
  if (!text.trim()) return { ok: false, error: "Kein Text." };

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return { ok: false, error: "MISTRAL_API_KEY nicht gesetzt." };

  const sb = getSupabaseAdmin();
  const { data: cfg } = await sb
    .from("admin_tts_config")
    .select("ref_audio, voice_id, model")
    .eq("id", "singleton")
    .maybeSingle();

  const model = cfg?.model ?? process.env.MISTRAL_TTS_MODEL ?? "voxtral-mini-tts-2603";
  const body: Record<string, unknown> = {
    model,
    input: text.trim(),
    response_format: "mp3",
  };
  if (cfg?.ref_audio) {
    body.ref_audio = cfg.ref_audio;
  } else if (cfg?.voice_id) {
    body.voice_id = cfg.voice_id;
  } else {
    body.voice_id = process.env.MISTRAL_TTS_VOICE_ID ?? "Jane";
  }

  const res = await fetch("https://api.mistral.ai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `Mistral ${res.status}: ${t.slice(0, 200)}` };
  }
  const json = await res.json().catch(() => null);
  const audioB64 = json?.audio_data as string | undefined;
  if (!audioB64) return { ok: false, error: "Kein audio_data in Mistral-Antwort." };
  return { ok: true, audioB64 };
}
