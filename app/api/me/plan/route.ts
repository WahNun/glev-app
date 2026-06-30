/**
 * GET /api/me/plan — returns the effective plan ("free" | "beta" | "pro")
 * for the signed-in user, using the SAME precedence the admin panel uses
 * (manual_plan_override → profiles.plan → subscription_status → free).
 *
 * Why server-side instead of querying profiles directly from the browser:
 * the browser client uses the anon key + RLS. If RLS on `profiles` doesn't
 * expose the override columns to the user themselves (or any other RLS
 * quirk), the read silently returns null and the UI falls back to "free"
 * — even when the admin panel clearly shows the user is on Pro. Doing
 * the read here with the service-role admin client guarantees the same
 * answer the admin sees.
 *
 * Auth: cookie session (web) or Bearer token (native shells).
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";

type AuthOk = { user: User; sb: SupabaseClient };
type AuthErr = { user: null; sb: null; error: string };

async function authedClient(req: NextRequest): Promise<AuthOk | AuthErr> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    if (all.length > 0) {
      const sb = createServerClient(url, anon, {
        cookies: {
          getAll: () => all.map((c) => ({ name: c.name, value: c.value })),
          setAll: () => {},
        },
      });
      const { data } = await sb.auth.getUser();
      if (data?.user) return { user: data.user, sb };
    }
  } catch {
    /* fall through */
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    if (data?.user) return { user: data.user, sb };
  }

  return { user: null, sb: null, error: "unauthorized" };
}

export async function GET(req: NextRequest) {
  const a = await authedClient(req);
  if (!a.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  // Two-step read: the always-required columns first, then the optional
  // legacy `subscription_status` column separately. Production Supabase
  // doesn't always have `subscription_status` (the column is referenced
  // throughout the code as a legacy beta pathway, but the migration that
  // was supposed to add it never landed in prod). If we put it in the
  // SAME `.select(...)` as the required columns and the column is
  // missing, the entire SELECT fails with PostgREST 42703, the catch
  // returns `{ plan: "free" }` and every Pro / override user sees "Free"
  // in the account modal regardless of what admin set. Splitting the
  // read keeps the route resilient: if the optional column is gone, we
  // simply treat it as null and let manual_plan_override / profiles.plan
  // do their job.
  const { data: row, error } = await admin
    .from("profiles")
    .select("manual_plan_override, manual_plan_expires_at, plan, trial_start_at, trial_end_at")
    .eq("user_id", a.user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { plan: "free", warning: `profiles read failed: ${error.message}` },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  let subscriptionStatus: string | null = null;
  let subscriptionSource: string | null = null;
  try {
    const { data: subRow, error: subErr } = await admin
      .from("profiles")
      .select("subscription_status, subscription_source")
      .eq("user_id", a.user.id)
      .maybeSingle();
    if (!subErr && subRow) {
      const r = subRow as { subscription_status?: unknown; subscription_source?: unknown };
      if (typeof r.subscription_status === "string") subscriptionStatus = r.subscription_status;
      if (typeof r.subscription_source === "string") subscriptionSource = r.subscription_source;
    }
  } catch {
    /* columns missing in this environment — fall through with null */
  }

  // Single source of truth: `profiles.plan` is now kept in sync by the
  // Pro Stripe webhook (`/api/pro/webhook` → syncProfilePlanByEmail) for
  // every status transition (trial start, active renewal, cancel). Beta
  // continues to flow through `profiles.subscription_status` (set by the
  // beta webhook). The previous `pro_subscriptions` / `beta_reservations`
  // fallback was removed once the webhook + backfill (Task #295) shipped.
  const plan = computeEffectivePlan({
    manual_plan_override: row?.manual_plan_override ?? null,
    manual_plan_expires_at: row?.manual_plan_expires_at ?? null,
    plan: row?.plan ?? null,
    subscription_status: subscriptionStatus,
    trial_start_at: (row as { trial_start_at?: string | null } | null)?.trial_start_at ?? null,
    trial_end_at: (row as { trial_end_at?: string | null } | null)?.trial_end_at ?? null,
  });

  // Trial status — used by usePlan() / canAccess() for feature gating.
  // D-023: kein Plan-Typ "trial"; stattdessen trial_end_at + plan === "free"
  // kombiniert prüfen. Paid users (beta/pro/plus) bekommen trialActive=false
  // auch wenn trial_end_at gesetzt ist — ihr Plan-Tier entscheidet.
  const trialEndAt = (row as { trial_end_at?: string | null } | null)?.trial_end_at ?? null;
  const trialActive =
    plan === "free" &&
    trialEndAt != null &&
    new Date(trialEndAt) > new Date();

  return NextResponse.json(
    {
      plan,
      trial_active: trialActive,
      trial_ends_at: trialEndAt,
      subscription_source: subscriptionSource,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
