// Lightweight AI usage logging — preparation for a future `ai_usage_logs` table.
//
// NO database yet. This just centralizes a structured server-side log line per
// AI call, tagged with a `source` (cost bucket), so a later DB-backed
// implementation can swap the sink without touching call sites. Dev Cockpit AI
// calls pass source = "dev_cockpit" to keep their cost separable from
// user-facing Glev AI.
//
// Never logs secrets (no API keys, no prompt/response bodies) and never throws
// — logging must not break an AI call.

export type AiUsageSource =
  | "dev_cockpit"
  | "glev_user"
  | "insights"
  | "meal_analysis"
  | "voice"
  | "other";

export interface AiUsageEvent {
  /** Cost bucket. Dev Cockpit AI always passes "dev_cockpit". */
  source: AiUsageSource;
  /** Model id, e.g. "mistral-large-latest". */
  model: string;
  /** Logical operation, e.g. "analyze_task". */
  operation?: string;
  /** Whether the call succeeded. */
  ok: boolean;
  /** Token counts when the provider reports them. */
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Wall-clock duration of the call in ms, when measured. */
  ms?: number;
}

/**
 * Record one AI usage event. Currently a structured console line; later this
 * becomes an insert into `ai_usage_logs`. Safe to call from any server path.
 */
export function logAiUsage(event: AiUsageEvent): void {
  try {
    // eslint-disable-next-line no-console
    console.log(
      "[ai_usage]",
      JSON.stringify({
        source: event.source,
        model: event.model,
        operation: event.operation ?? null,
        ok: event.ok,
        prompt_tokens: event.promptTokens ?? null,
        completion_tokens: event.completionTokens ?? null,
        total_tokens: event.totalTokens ?? null,
        ms: event.ms ?? null,
      }),
    );
  } catch {
    /* logging must never throw */
  }
}
