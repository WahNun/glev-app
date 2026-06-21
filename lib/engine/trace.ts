import type { SupabaseClient } from "@supabase/supabase-js";

export type TraceType =
  | "bolus_calc"
  | "icr_lookup"
  | "cgm_fetch"
  | "voice_intent"
  | "photo_analysis"
  | "recipe_suggestion";

export type TraceStep = {
  name: string;
  success: boolean;
  latency_ms?: number;
  detail?: unknown;
};

export class EngineTrace {
  private readonly startedAt: number;
  private steps: TraceStep[] = [];
  private output: unknown = null;
  private error: string | null = null;

  constructor(
    public readonly type: TraceType,
    private readonly input: unknown,
  ) {
    this.startedAt = Date.now();
  }

  recordStep(
    name: string,
    opts: { success: boolean; latency_ms?: number; detail?: unknown },
  ): void {
    this.steps.push({ name, ...opts });
  }

  setOutput(output: unknown): void {
    this.output = output;
  }

  setError(err: string): void {
    this.error = err;
  }

  async persist(opts: {
    user_id: string;
    supabase: SupabaseClient;
    app_version: string;
    env: string;
  }): Promise<void> {
    const total_latency_ms = Date.now() - this.startedAt;
    try {
      const { error } = await opts.supabase.from("engine_traces").insert({
        user_id:         opts.user_id,
        trace_type:      this.type,
        input:           this.input,
        output:          this.output,
        steps:           this.steps,
        total_latency_ms,
        error:           this.error,
        app_version:     opts.app_version,
        env:             opts.env,
      });
      if (error) {
        console.warn(`[engine-trace:${this.type}] persist error:`, error.message);
      }
    } catch (e) {
      console.warn(
        `[engine-trace:${this.type}] persist failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}
