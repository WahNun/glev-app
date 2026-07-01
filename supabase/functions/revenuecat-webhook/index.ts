/**
 * Supabase Edge Function: revenuecat-webhook
 *
 * Receives RevenueCat webhook events and syncs subscription status to profiles.
 *
 * Supported events:
 *   INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, UNCANCELLATION → mark active
 *   EXPIRATION → downgrade to expired (access lost)
 *   BILLING_ISSUE → mark billing_issue (falls through to free in computeEffectivePlan)
 *   CANCELLATION → skipped (Apple semantics: no auto-renew, access until period end — not an access loss)
 *
 * Authentication: Authorization header must match REVENUECAT_WEBHOOK_AUTH_HEADER env var.
 *
 * Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
 * Register URL in RevenueCat: Project → Integrations → Webhooks → Add endpoint
 *
 * profiles columns written:
 *   subscription_status  TEXT  — "pro" | "plus" | "beta" | "expired" | "billing_issue"
 *   subscription_source  TEXT  — "apple_iap" | null
 *
 * Mapping (entitlement_id → subscription_status):
 *   glev_smart → "beta"  (planLabel("beta") = "Smart" in der UI)
 *   glev_pro   → "pro"
 *   glev_plus  → "plus"
 *
 * NOTE: subscription_tier and subscription_renews_at are NOT written —
 * those columns do not exist in the production schema. computeEffectivePlan()
 * reads subscription_status, not subscription_tier.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_AUTH_HEADER = Deno.env.get("REVENUECAT_WEBHOOK_AUTH_HEADER") ?? "";

const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

const INACTIVE_EVENTS = new Set([
  "EXPIRATION",
  "BILLING_ISSUE",
]);

// Maps RevenueCat entitlement IDs to the internal subscription_status values
// that computeEffectivePlan() recognizes as paid tiers.
function statusFromEntitlements(entitlementIds: string[]): "pro" | "plus" | "beta" {
  if (entitlementIds.includes("glev_pro")) return "pro";
  if (entitlementIds.includes("glev_plus")) return "plus";
  return "beta"; // glev_smart → zeigt "Smart" in der UI via planLabel()
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!WEBHOOK_AUTH_HEADER || authHeader !== WEBHOOK_AUTH_HEADER) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const event = body.event as Record<string, unknown> | undefined;
  if (!event) {
    return new Response("Missing event", { status: 400 });
  }

  const eventType = event.type as string | undefined;
  const appUserId = event.app_user_id as string | undefined;

  if (!eventType || !appUserId) {
    return new Response("Missing event.type or app_user_id", { status: 400 });
  }

  if (!ACTIVE_EVENTS.has(eventType) && !INACTIVE_EVENTS.has(eventType)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const entitlementIds = Object.keys(
    (event.entitlement_ids as Record<string, unknown>) ?? {}
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let updateData: Record<string, unknown>;

  if (ACTIVE_EVENTS.has(eventType)) {
    updateData = {
      subscription_status: statusFromEntitlements(entitlementIds),
      subscription_source: "apple_iap",
    };
  } else if (eventType === "BILLING_ISSUE") {
    updateData = {
      subscription_status: "billing_issue",
    };
  } else {
    // EXPIRATION only — CANCELLATION falls through to skipped above
    updateData = {
      subscription_status: "expired",
      subscription_source: null,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("user_id", appUserId);

  if (error) {
    console.error("[revenuecat-webhook] DB update failed:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, eventType, appUserId }), {
    headers: { "Content-Type": "application/json" },
  });
});
