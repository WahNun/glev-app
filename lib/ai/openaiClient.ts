import OpenAI from "openai";

let cached: OpenAI | null = null;
let cachedMistralChat: OpenAI | null = null;

/**
 * Returns a configured OpenAI client.
 *
 * Resolution order (first match wins):
 *   1. Replit AI Integrations proxy
 *      - AI_INTEGRATIONS_OPENAI_BASE_URL
 *      - AI_INTEGRATIONS_OPENAI_API_KEY
 *   2. Standard OpenAI direct
 *      - OPENAI_BASE_URL  (defaults to https://api.openai.com/v1)
 *      - OPENAI_API_KEY
 *
 * Throws a clear error when no key is found in either form so we never
 * silently produce confusing 401s.
 */
export function getOpenAIClient(): OpenAI {
  const integrationKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const integrationBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  const fallbackKey  = process.env.OPENAI_API_KEY;
  const fallbackBase = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  let apiKey: string | undefined;
  let baseURL: string | undefined;

  if (integrationKey && integrationBase) {
    apiKey = integrationKey;
    baseURL = integrationBase;
  } else if (fallbackKey) {
    apiKey = fallbackKey;
    baseURL = fallbackBase;
  }

  if (!apiKey || !baseURL) {
    throw new Error(
      "Missing OpenAI API key. Set AI_INTEGRATIONS_OPENAI_API_KEY " +
      "(with AI_INTEGRATIONS_OPENAI_BASE_URL) or OPENAI_API_KEY in this environment."
    );
  }

  if (!cached) cached = new OpenAI({ baseURL, apiKey });
  return cached;
}

/**
 * Returns an OpenAI-SDK client pointed at Mistral's OpenAI-compatible API.
 * Used by all user-facing AI routes (chat, nutrition parsing, intent
 * classification, macro refinement) after the 2026-06-20 EU consolidation.
 * Throws a clear error when MISTRAL_API_KEY is missing so route handlers
 * can return 503 instead of crashing with an opaque 500.
 */
export function getMistralChatClient(): OpenAI {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing MISTRAL_API_KEY. Set it as a Replit Secret in dev and " +
      "as a Vercel Environment Variable (Production + Preview).",
    );
  }
  if (!cachedMistralChat) {
    cachedMistralChat = new OpenAI({
      baseURL: "https://api.mistral.ai/v1",
      apiKey,
    });
  }
  return cachedMistralChat;
}

export class AIConfigError extends Error {
  status = 503;
}

export function aiConfigError(): { error: string; status: number } {
  return {
    error: "AI service unavailable: integration env vars missing in this environment.",
    status: 503,
  };
}
