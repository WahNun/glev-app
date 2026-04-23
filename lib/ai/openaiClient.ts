import OpenAI from "openai";

let cached: OpenAI | null = null;

/**
 * Returns a configured OpenAI client that uses the Replit AI Integrations
 * proxy. Throws a clear error when the required env vars are not set so we
 * never silently fall back to a stale `OPENAI_API_KEY` (which produces
 * confusing 401 "Incorrect API key provided" errors in deployments).
 */
export function getOpenAIClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new Error(
      "AI service is not configured for this environment. " +
      "The Replit AI Integration env vars (AI_INTEGRATIONS_OPENAI_BASE_URL / " +
      "AI_INTEGRATIONS_OPENAI_API_KEY) are missing — re-run the integration " +
      "setup and redeploy."
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
