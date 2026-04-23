import OpenAI from "openai";

let cached: OpenAI | null = null;

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

export class AIConfigError extends Error {
  status = 503;
}

export function aiConfigError(): { error: string; status: number } {
  return {
    error: "AI service unavailable: integration env vars missing in this environment.",
    status: 503,
  };
}
