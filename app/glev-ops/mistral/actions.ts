"use server";

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { GLEV_CHAT_SYSTEM_PROMPT } from "@/lib/ai/glevChatPrompt";
import { bustSystemPromptCache } from "@/lib/ai/systemPromptCache";
import {
  DEFAULT_STYLE_PREFIX,
  type AgentPromptConfig,
  type PromptVersion,
  type StylePrefixConfig,
  type TtsConfig,
} from "./types";

export type { AgentPromptConfig, PromptVersion, StylePrefixConfig, TtsConfig };

const PROMPT_KEY = "glev_ai_default";

export async function getAgentPrompt(): Promise<AgentPromptConfig | null> {
  if (!(await isAdminAuthed())) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("ai_agent_prompts")
    .select("prompt_text, version, updated_at, updated_by")
    .eq("key", PROMPT_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) {
    return {
      promptText: GLEV_CHAT_SYSTEM_PROMPT,
      version: 0,
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    };
  }
  return {
    promptText: data.prompt_text || GLEV_CHAT_SYSTEM_PROMPT,
    version: data.version ?? 1,
    updatedAt: data.updated_at ?? null,
    updatedBy: data.updated_by ?? null,
    isDefault: false,
  };
}

export async function saveAgentPrompt(
  text: string,
  adminEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };
  if (!text.trim()) return { ok: false, error: "Prompt darf nicht leer sein." };

  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("ai_agent_prompts")
    .select("version")
    .eq("key", PROMPT_KEY)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;
  const now = new Date().toISOString();

  const { error } = await sb.from("ai_agent_prompts").upsert(
    {
      key: PROMPT_KEY,
      title: "Glev AI Chat System Prompt",
      prompt_text: text.trim(),
      is_active: true,
      version: nextVersion,
      updated_by: adminEmail,
      updated_at: now,
    },
    { onConflict: "key" },
  );

  if (error) return { ok: false, error: error.message };

  const { error: histError } = await sb.from("ai_agent_prompt_versions").insert({
    prompt_key: PROMPT_KEY,
    version: nextVersion,
    prompt_text: text.trim(),
    saved_by: adminEmail,
    saved_at: now,
    is_reset: false,
  });

  if (histError) return { ok: false, error: `Prompt gespeichert, aber Verlaufseintrag fehlgeschlagen: ${histError.message}` };

  bustSystemPromptCache();
  return { ok: true };
}

export async function resetAgentPrompt(
  adminEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };

  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("ai_agent_prompts")
    .select("version")
    .eq("key", PROMPT_KEY)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;
  const now = new Date().toISOString();

  const { error } = await sb.from("ai_agent_prompts").upsert(
    {
      key: PROMPT_KEY,
      title: "Glev AI Chat System Prompt",
      prompt_text: GLEV_CHAT_SYSTEM_PROMPT,
      is_active: true,
      version: nextVersion,
      updated_by: adminEmail,
      updated_at: now,
    },
    { onConflict: "key" },
  );

  if (error) return { ok: false, error: error.message };

  const { error: histError } = await sb.from("ai_agent_prompt_versions").insert({
    prompt_key: PROMPT_KEY,
    version: nextVersion,
    prompt_text: GLEV_CHAT_SYSTEM_PROMPT,
    saved_by: adminEmail,
    saved_at: now,
    is_reset: true,
  });

  if (histError) return { ok: false, error: `Prompt zurückgesetzt, aber Verlaufseintrag fehlgeschlagen: ${histError.message}` };

  bustSystemPromptCache();
  return { ok: true };
}

const VERSIONS_PAGE_SIZE = 20;

export async function getPromptVersions(page = 0): Promise<{ versions: PromptVersion[]; hasMore: boolean } | null> {
  if (!(await isAdminAuthed())) return null;
  const sb = getSupabaseAdmin();
  const from = page * VERSIONS_PAGE_SIZE;
  const to = from + VERSIONS_PAGE_SIZE;
  const { data, error } = await sb
    .from("ai_agent_prompt_versions")
    .select("id, version, prompt_text, saved_by, saved_at, is_reset")
    .eq("prompt_key", PROMPT_KEY)
    .order("version", { ascending: false })
    .range(from, to);

  if (error || !data) return { versions: [], hasMore: false };
  const hasMore = data.length > VERSIONS_PAGE_SIZE;
  const versions = data.slice(0, VERSIONS_PAGE_SIZE).map((r) => ({
    id: r.id as string,
    version: r.version as number,
    promptText: r.prompt_text as string,
    savedBy: (r.saved_by as string | null) ?? null,
    savedAt: r.saved_at as string,
    isReset: r.is_reset as boolean,
  }));
  return { versions, hasMore };
}

// ── Style-Prefix ─────────────────────────────────────────────────────────────

export async function getStylePrefix(): Promise<StylePrefixConfig | null> {
  if (!(await isAdminAuthed())) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("admin_tts_config")
    .select("style_prefix, updated_at")
    .eq("id", "singleton")
    .maybeSingle();
  const raw = (data?.style_prefix as string | null) ?? null;
  return {
    text: raw?.trim() || DEFAULT_STYLE_PREFIX,
    isDefault: !raw?.trim(),
    updatedAt: data?.updated_at ?? null,
  };
}

export async function saveStylePrefix(
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };
  const trimmed = text.trim();
  if (trimmed.length > 2000) return { ok: false, error: "Style-Prefix zu lang (max 2000 Zeichen)." };

  const sb = getSupabaseAdmin();
  // Store NULL when the admin explicitly resets to the default (empty submission)
  const { error } = await sb.from("admin_tts_config").upsert(
    {
      id: "singleton",
      style_prefix: trimmed || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resetStylePrefix(): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAdminAuthed())) return { ok: false, error: "Nicht eingeloggt." };
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("admin_tts_config").upsert(
    { id: "singleton", style_prefix: null, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "audio/wav", "audio/x-wav", "audio/wave",
  "audio/mpeg", "audio/mp3",
  "audio/flac", "audio/x-flac",
  "audio/ogg", "audio/opus",
  "audio/pcm",
]);

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
