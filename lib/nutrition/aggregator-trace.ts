import type { SupabaseClient } from "@supabase/supabase-js";

export type LookupAttempt = {
  source: "user_history" | "open_food_facts" | "usda" | "llm";
  success: boolean;
  hit_count?: number;
  latency_ms: number;
  response_excerpt?: string;
};

export type TraceSnapshot = {
  parsed_food: unknown;
  lookups: LookupAttempt[];
  final_nutrition_source: string | null;
  final_macros: unknown;
  total_latency_ms: number;
  llm_request_id: string | null;
};

export class AggregatorTrace {
  private startedAt = Date.now();
  private lookups: LookupAttempt[] = [];
  private parsedFood: unknown = null;
  private finalSource: string | null = null;
  private finalMacros: unknown = null;
  private llmRequestId: string | null = null;

  recordLookup(attempt: LookupAttempt): void {
    this.lookups.push(attempt);
  }

  setParsedFood(parsed: unknown): void {
    this.parsedFood = parsed;
  }

  setFinalSource(source: string): void {
    this.finalSource = source;
  }

  setFinalMacros(macros: unknown): void {
    this.finalMacros = macros;
  }

  setLlmRequestId(id: string): void {
    this.llmRequestId = id;
  }

  snapshot(): TraceSnapshot {
    return {
      parsed_food:            this.parsedFood,
      lookups:                [...this.lookups],
      final_nutrition_source: this.finalSource,
      final_macros:           this.finalMacros,
      total_latency_ms:       Date.now() - this.startedAt,
      llm_request_id:         this.llmRequestId,
    };
  }

  async persist(opts: {
    user_id: string;
    input_text: string;
    supabaseClient: SupabaseClient;
    aggregator_version: string;
    env: string;
  }): Promise<void> {
    const snap = this.snapshot();
    try {
      const { error } = await opts.supabaseClient.from("aggregator_traces").insert({
        user_id:               opts.user_id,
        input_text:            opts.input_text,
        parsed_food:           snap.parsed_food,
        lookups:               snap.lookups,
        final_nutrition_source: snap.final_nutrition_source,
        final_macros:          snap.final_macros,
        total_latency_ms:      snap.total_latency_ms,
        llm_request_id:        snap.llm_request_id,
        aggregator_version:    opts.aggregator_version,
        env:                   opts.env,
      });
      if (error) {
        console.warn("[aggregator-trace] persist error:", error.message);
      }
    } catch (e) {
      console.warn("[aggregator-trace] persist failed:", e instanceof Error ? e.message : e);
    }
  }
}
