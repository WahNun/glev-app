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

// ---------------------------------------------------------------------------
// Dev Cockpit — separate credential bucket
// ---------------------------------------------------------------------------
//
// Dev Cockpit AI (Analyze Task, Re-Analyze, future queue evaluation / build
// planning / coding agent) bills against its OWN key so its cost can be tracked
// separately from user-facing Glev AI. It prefers MISTRAL_DEV_COCKPIT_API_KEY
// and falls back to MISTRAL_API_KEY so existing environments keep working.

let cachedDevCockpit: Mistral | null = null;

/**
 * Resolve the Mistral key for Dev Cockpit AI calls.
 *   1. MISTRAL_DEV_COCKPIT_API_KEY if set (preferred — separate cost bucket)
 *   2. otherwise MISTRAL_API_KEY (fallback for existing environments)
 *   3. throw a meaningful error if neither exists
 */
export function getDevCockpitMistralKey(): string {
  const devKey = process.env.MISTRAL_DEV_COCKPIT_API_KEY;
  if (devKey) return devKey;
  const fallback = process.env.MISTRAL_API_KEY;
  if (fallback) return fallback;
  throw new Error(
    "Missing Dev Cockpit Mistral key. Set MISTRAL_DEV_COCKPIT_API_KEY (preferred, " +
      "separate cost bucket) or MISTRAL_API_KEY (fallback) as a Replit Secret in " +
      "dev and a Vercel Environment Variable (Production + Preview).",
  );
}

/** Mistral client for Dev Cockpit AI, using the Dev Cockpit key (see above). */
export function getDevCockpitMistralClient(): Mistral {
  if (!cachedDevCockpit) {
    cachedDevCockpit = new Mistral({ apiKey: getDevCockpitMistralKey() });
  }
  return cachedDevCockpit;
}
