export const DEFAULT_STYLE_PREFIX =
  "Sprich warm, ruhig und natürlich — wie ein vertrauter Assistent beim Gespräch unter vier Augen. Keine übertriebene Betonung, keine Pausen zwischen Wörtern, fließend und menschlich.";

export interface AgentPromptConfig {
  promptText: string;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  isDefault: boolean;
}

export interface PromptVersion {
  id: string;
  version: number;
  promptText: string;
  savedBy: string | null;
  savedAt: string;
  isReset: boolean;
}

export interface StylePrefixConfig {
  text: string;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface TtsConfig {
  hasRefAudio: boolean;
  refAudioPreviewB64: string | null;
  voiceId: string | null;
  model: string;
  updatedAt: string | null;
}
