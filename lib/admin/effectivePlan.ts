export type EffectivePlan = "free" | "beta" | "pro";

export type PlanInputs = {
  manual_plan_override?: string | null;
  plan?: string | null;
  subscription_status?: string | null;
};

/**
 * Single source of truth for "which plan does this user actually have".
 *
 * Precedence:
 *   1. manual_plan_override   — admin-granted (Stage 2). Always wins.
 *   2. profiles.plan          — written by the Stripe webhooks.
 *   3. subscription_status    — legacy column, also written by Beta hook.
 *   4. fallback               — "free".
 *
 * Keep this pure / synchronous. Used by the admin UI today; the rest of
 * the app can adopt it later for paywall checks (it's intentionally
 * not wired into pro-feature gating yet — that's a separate task).
 */
export function computeEffectivePlan(p: PlanInputs): EffectivePlan {
  const o = (p.manual_plan_override ?? "").toLowerCase();
  if (o === "pro") return "pro";
  if (o === "beta") return "beta";
  if (o === "free") return "free";

  const plan = (p.plan ?? "").toLowerCase();
  if (plan === "pro") return "pro";
  if (plan === "beta") return "beta";

  const sub = (p.subscription_status ?? "").toLowerCase();
  if (sub === "pro") return "pro";
  if (sub === "beta") return "beta";

  return "free";
}

export function planLabel(p: EffectivePlan): string {
  if (p === "pro") return "Pro";
  if (p === "beta") return "Beta";
  return "Free";
}

export function planColor(p: EffectivePlan): { bg: string; fg: string } {
  if (p === "pro") return { bg: "#5b6cff22", fg: "#3b4cdc" };
  if (p === "beta") return { bg: "#10b98122", fg: "#047857" };
  return { bg: "#e5e7eb", fg: "#374151" };
}
