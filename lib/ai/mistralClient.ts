import { Mistral } from "@mistralai/mistralai";

let cached: Mistral | null = null;

/**
 * Returns a configured Mistral client. Mirrors the style of
 * `lib/ai/openaiClient.ts`. Throws a clear error when the key is
 * missing so route handlers can return a 503 instead of crashing
 * with an opaque 500.
 *
 * Mistral powers the user-facing Glev AI chat (streaming bubbles).
 * Nutrition parsing keeps using OpenAI (`getOpenAIClient`) — the
 * two are intentionally separate so swapping one provider does not
 * affect the other.
 */
export function getMistralClient(): Mistral {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing MISTRAL_API_KEY. Set it as a Replit Secret in dev and " +
      "as a Vercel Environment Variable (Production + Preview) for " +
      "the Glev AI chat to work."
    );
  }
  if (!cached) cached = new Mistral({ apiKey });
  return cached;
}

export function mistralConfigError(): { error: string; status: number } {
  return {
    error:
      "AI chat unavailable: MISTRAL_API_KEY is not configured in this environment.",
    status: 503,
  };
}
