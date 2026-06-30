export type EffectivePlan = "free" | "beta" | "pro" | "plus";

export type PlanInputs = {
  manual_plan_override?: string | null;
  manual_plan_expires_at?: string | null;
  plan?: string | null;
  subscription_status?: string | null;
  trial_start_at?: string | null;
  trial_end_at?: string | null;
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
  // Admin-Override hat Ablaufdatum (z.B. Beta-Free-Year): wenn abgelaufen,
  // Override ignorieren und auf reguläre Plan-Ermittlung zurückfallen.
  const expiresAt = p.manual_plan_expires_at
    ? Date.parse(p.manual_plan_expires_at)
    : NaN;
  const overrideExpired =
    Number.isFinite(expiresAt) && expiresAt < Date.now();
  if (!overrideExpired) {
    if (o === "plus") return "plus";
    if (o === "pro") return "pro";
    if (o === "beta") return "beta";
    if (o === "free") return "free";
  }

  const plan = (p.plan ?? "").toLowerCase();
  if (plan === "pro") return "pro";
  if (plan === "beta") return "beta";

  const sub = (p.subscription_status ?? "").toLowerCase();
  if (sub === "pro") return "pro";
  if (sub === "beta") return "beta";
  // Glev+ is stored as subscription_status = 'plus' by the Stripe webhook
  // (/api/pro/webhook). It was not previously mapped here, causing plus
  // users to fall through to "free". Fixed.
  if (sub === "plus") return "plus";

  // Trial-Check: aktiver Trial → volle Pro-Erfahrung
  const now = Date.now();
  const trialEnd = p.trial_end_at ? Date.parse(p.trial_end_at) : 0;
  if (p.trial_start_at && trialEnd > now) return "pro";

  return "free";
}

export function planLabel(p: EffectivePlan): string {
  if (p === "pro") return "Pro";
  if (p === "plus") return "Plus";
  if (p === "beta") return "Smart";
  return "Free";
}

export function planColor(p: EffectivePlan): { bg: string; fg: string } {
  if (p === "pro") return { bg: "#5b6cff22", fg: "#3b4cdc" };
  if (p === "plus") return { bg: "#a78bfa22", fg: "#7c3aed" };
  if (p === "beta") return { bg: "#10b98122", fg: "#047857" };
  return { bg: "#e5e7eb", fg: "#374151" };
}
