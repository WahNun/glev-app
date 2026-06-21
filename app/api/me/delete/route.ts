/**
 * POST /api/me/delete
 *
 * Self-service hard-delete (Apple 5.1.1(v) + DSGVO Art. 17).
 * Deletes the calling user's account and all associated data.
 *
 * Sequence:
 *   1. Stripe — cancel active sub + delete customer (non-fatal on error)
 *   2. Storage — remove all files in glev-ai-attachments/{userId}/ (non-fatal)
 *   3. DB — explicit DELETE on all tables with user_id (no FK cascade)
 *   4. Email-based tables — email_drip_schedule, email_drip_unsubscribes
 *   5. profiles DELETE (triggers CASCADE: ai_pending_actions, ai_user_memory,
 *      hypo_push_cooldown, sms_optout_events, cgm_credentials, referrals)
 *   6. auth.admin.deleteUser() — removes from auth.users
 *
 * Idempotent: each step runs even if a prior step errored.
 * Non-fatal steps are logged but never block the final auth deletion.
 *
 * Auth: Supabase cookie session (web) or Bearer token (native).
 */
import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/lib/api/authedClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getStripe } from "@/lib/stripeServer";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const AI_BUCKET = "glev-ai-attachments";

// Tables that have user_id but NO FK cascade to profiles.
// Ordered: leaf tables first so any implicit deps are already gone.
const USER_ID_TABLES = [
  "user_settings_history",
  "user_settings",
  "user_preferences",
  "user_icr_schedule",
  "user_food_history",
  "user_feedback",
  "symptom_logs",
  "sleep_sessions",
  "rejected_pairs",
  "nightscout_readings",
  "menstrual_logs",
  "meals",
  "meal_timeline_checks",
  "meal_prep_refinements",
  "meal_glucose_samples",
  "insulin_logs",
  "influence_logs",
  "hyper_push_cooldown",
  "fingerstick_readings",
  "exercise_logs",
  "exercise_glucose_samples",
  "elevated_push_cooldown",
  "daily_activity_summary",
  "cgm_setup_requests",
  "cgm_samples",
  "cgm_fetch_jobs",
  "cgm_credentials",
  "cancellation_feedback",
  "bolus_glucose_samples",
  "appointments",
  "apple_health_readings",
  "ai_rate_limit_hits",
  // Cascade-covered by profiles but deleted defensively:
  "ai_pending_actions",
  "ai_user_memory",
  "hypo_push_cooldown",
  "sms_optout_events",
] as const;

async function cleanupStripe(admin: SupabaseClient, email: string): Promise<void> {
  try {
    const stripe = getStripe();

    const { data: subRow } = await admin
      .from("pro_subscriptions")
      .select("stripe_subscription_id, stripe_customer_id, status")
      .eq("email", email)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .maybeSingle();

    const subId = (subRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id;
    const customerId = (subRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;

    if (subId) {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (e) {
        console.warn("[api/me/delete] stripe sub cancel failed (continuing):", e);
      }
    }

    if (customerId) {
      try {
        await stripe.customers.del(customerId);
      } catch (e) {
        console.warn("[api/me/delete] stripe customer delete failed (continuing):", e);
      }
    }
  } catch (e) {
    console.warn("[api/me/delete] stripe cleanup failed (non-fatal):", e);
  }
}

async function cleanupStorage(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data: folders } = await admin.storage.from(AI_BUCKET).list(userId);
    if (!folders?.length) return;

    for (const folder of folders) {
      const { data: files } = await admin.storage
        .from(AI_BUCKET)
        .list(`${userId}/${folder.name}`);
      if (!files?.length) continue;
      const paths = files.map((f) => `${userId}/${folder.name}/${f.name}`);
      const { error } = await admin.storage.from(AI_BUCKET).remove(paths);
      if (error) {
        console.warn("[api/me/delete] storage remove partial error:", error.message);
      }
    }
  } catch (e) {
    console.warn("[api/me/delete] storage cleanup failed (non-fatal):", e);
  }
}

async function deleteUserIdTables(admin: SupabaseClient, userId: string): Promise<void> {
  for (const table of USER_ID_TABLES) {
    try {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) {
        console.warn(`[api/me/delete] ${table} delete error:`, error.message);
      }
    } catch (e) {
      console.warn(`[api/me/delete] ${table} delete threw:`, e);
    }
  }
}

async function deleteEmailTables(admin: SupabaseClient, email: string): Promise<void> {
  const emailTables = ["email_drip_schedule", "email_drip_unsubscribes"] as const;
  for (const table of emailTables) {
    try {
      const { error } = await admin.from(table).delete().eq("email", email);
      if (error) {
        console.warn(`[api/me/delete] ${table} delete error:`, error.message);
      }
    } catch (e) {
      console.warn(`[api/me/delete] ${table} delete threw:`, e);
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = auth.user.id;
  const email = auth.user.email?.toLowerCase() ?? "";
  const admin = getSupabaseAdmin();

  // 1. Stripe (non-fatal)
  if (email) {
    await cleanupStripe(admin, email);
  }

  // 2. Storage (non-fatal)
  await cleanupStorage(admin, userId);

  // 3. Explicit DB deletes by user_id
  await deleteUserIdTables(admin, userId);

  // 4. Email-based tables
  if (email) {
    await deleteEmailTables(admin, email);
  }

  // 5. profiles — CASCADE handles: ai_pending_actions, ai_user_memory,
  //    hypo_push_cooldown, sms_optout_events, cgm_credentials, referrals
  try {
    const { error } = await admin.from("profiles").delete().eq("user_id", userId);
    if (error) {
      console.warn("[api/me/delete] profiles delete error:", error.message);
    }
  } catch (e) {
    console.warn("[api/me/delete] profiles delete threw:", e);
  }

  // 6. auth.admin.deleteUser() — MUST succeed; fatal if it errors
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    console.error("[api/me/delete] auth.admin.deleteUser failed:", authErr.message);
    return NextResponse.json(
      { error: "delete_failed", detail: authErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
