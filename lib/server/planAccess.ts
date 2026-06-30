import { createClient } from "@supabase/supabase-js";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";
import { canAccess } from "@/lib/planFeatures";

function makeAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function checkPlanAccess(userId: string, feature: string): Promise<boolean> {
  try {
    const admin = makeAdmin();
    const { data } = await admin
      .from("profiles")
      .select("plan, manual_plan_override, manual_plan_expires_at, trial_start_at, trial_end_at")
      .eq("user_id", userId)
      .maybeSingle();
    const effectivePlan = computeEffectivePlan({
      plan: data?.plan ?? null,
      manual_plan_override: data?.manual_plan_override ?? null,
      manual_plan_expires_at: data?.manual_plan_expires_at ?? null,
      trial_start_at: (data as { trial_start_at?: string | null } | null)?.trial_start_at ?? null,
      trial_end_at: data?.trial_end_at ?? null,
    });
    const trialActive =
      effectivePlan === "free" &&
      !!data?.trial_end_at &&
      new Date(data.trial_end_at) > new Date();
    return canAccess(feature, effectivePlan, trialActive);
  } catch {
    return false;
  }
}
