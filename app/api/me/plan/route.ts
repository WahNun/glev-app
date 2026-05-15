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
  const { data: row, error } = await admin
    .from("profiles")
    .select("manual_plan_override, manual_plan_expires_at, plan, subscription_status")
    .eq("user_id", a.user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { plan: "free", warning: `profiles read failed: ${error.message}` },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  let plan = computeEffectivePlan({
    manual_plan_override: row?.manual_plan_override ?? null,
    manual_plan_expires_at: row?.manual_plan_expires_at ?? null,
    plan: row?.plan ?? null,
    subscription_status: row?.subscription_status ?? null,
  });

  // Fallback: der Pro-Stripe-Webhook schreibt nur in `pro_subscriptions`,
  // nicht in `profiles.plan`. D.h. Trial-/Active-Pro-User würden hier
  // sonst als "free" raus. Wenn computeEffectivePlan auf free gefallen
  // ist UND es eine aktive Pro-Subscription gibt, korrigieren wir hier.
  // Beta-Käufer:innen werden separat in `beta_reservations` getrackt;
  // wenn `profiles.subscription_status="beta"` schon greift, bleibt es
  // beim Beta-Pfad — sonst Fallback hier.
  if (plan === "free") {
    const { data: pro } = await admin
      .from("pro_subscriptions")
      .select("status")
      .eq("user_id", a.user.id)
      .maybeSingle();
    const proStatus = (pro?.status ?? "").toLowerCase();
    if (["trialing", "active", "past_due"].includes(proStatus)) {
      plan = "pro";
    } else {
      const userEmail = (a.user.email ?? "").toLowerCase();
      if (userEmail) {
        const { data: beta } = await admin
          .from("beta_reservations")
          .select("status")
          .eq("email", userEmail)
          .maybeSingle();
        const betaStatus = (beta?.status ?? "").toLowerCase();
        if (betaStatus === "paid") {
          plan = "beta";
        }
      }
    }
  }

  return NextResponse.json(
    { plan },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
