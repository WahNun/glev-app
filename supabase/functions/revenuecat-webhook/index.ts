/**
 * Supabase Edge Function: revenuecat-webhook
 *
 * Receives RevenueCat webhook events and syncs subscription status to profiles.
 *
 * Supported events:
 *   INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE → mark active, set tier + expiry
 *   CANCELLATION, EXPIRATION, BILLING_ISSUE   → leave tier; mark cancel/expire state
 *   SUBSCRIBER_ALIAS                          → no-op (user merge, not relevant here)
 *
 * Authentication: Authorization header must match REVENUECAT_WEBHOOK_AUTH_HEADER env var.
 *
 * Deploy: supabase functions deploy revenuecat-webhook --no-verify-jwt
 * Register URL in RevenueCat: Project → Integrations → Webhooks → Add endpoint
 *
 * profiles columns used:
 *   subscription_tier       TEXT  ("free" | "smart" | "pro")
 *   subscription_source     TEXT  ("apple_iap" | "stripe" | ...)
 *   subscription_renews_at  TIMESTAMPTZ
 *   subscription_status     TEXT  ("active" | "cancelled" | "expired" | "billing_issue")
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
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
]);

function tierFromEntitlements(entitlementIds: string[]): "pro" | "smart" | "free" {
  if (entitlementIds.includes("glev_pro")) return "pro";
  if (entitlementIds.includes("glev_smart")) return "smart";
  return "free";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Verify shared secret
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

  // Skip events we don't handle
  if (!ACTIVE_EVENTS.has(eventType) && !INACTIVE_EVENTS.has(eventType)) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const entitlementIds = Object.keys(
    (event.entitlement_ids as Record<string, unknown>) ?? {}
  );
  const expirationAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms as number).toISOString()
    : null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let updateData: Record<string, unknown>;

  if (ACTIVE_EVENTS.has(eventType)) {
    updateData = {
      subscription_tier: tierFromEntitlements(entitlementIds),
      subscription_source: "apple_iap",
      subscription_renews_at: expirationAt,
      subscription_status: "active",
    };
  } else if (eventType === "BILLING_ISSUE") {
    updateData = {
      subscription_status: "billing_issue",
      subscription_renews_at: expirationAt,
    };
  } else {
    // CANCELLATION or EXPIRATION — downgrade to free
    updateData = {
      subscription_tier: "free",
      subscription_status: eventType === "CANCELLATION" ? "cancelled" : "expired",
      subscription_renews_at: expirationAt,
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
