/**
 * Supabase Edge Function: hypo-check
 *
 * Runs every 5 minutes (see config.toml) and sends a push notification to
 * any user whose most recent CGM reading is below their configured low-alarm
 * threshold.
 *
 * Flow per user:
 *   1. Query user_settings for users with low_alarm_enabled = true
 *   2. Cross-reference with profiles to get their push_token / push_platform
 *      (only users who have both alarm enabled AND a push token receive a push)
 *   3. For each user: fetch the latest CGM reading from the last 10 minutes
 *   4. Compare against low_alarm_threshold_mgdl (default 70 mg/dL)
 *   5. Check hypo_push_cooldown — skip if last push was < 15 minutes ago
 *   6. Send FCM HTTP v1 push (Android) or APNs push (iOS)
 *   7. Upsert the cooldown row
 *
 * Table ownership:
 *   - push_token, push_platform, push_token_updated_at → profiles
 *   - low_alarm_enabled, low_alarm_threshold_mgdl     → user_settings
 *   - cooldown state                                  → hypo_push_cooldown
 *
 * Environment secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL              — auto-provided by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase runtime
 *
 *   Android (FCM HTTP v1 — legacy server key is DEAD since June 2024):
 *   FIREBASE_PROJECT_ID       — Firebase project ID (e.g. "glev-app-12345")
 *                               Find it: Firebase Console → Project Settings → General
 *   FIREBASE_SERVICE_ACCOUNT_JSON — Full service account JSON (one-line string)
 *                               Generate: Firebase Console → Project Settings →
 *                               Service Accounts → Generate new private key
 *
 *   iOS (APNs):
 *   APNS_KEY_P8               — APNs .p8 private key content (full PEM string)
 *   APNS_KEY_ID               — 10-character APNs key ID
 *   APNS_TEAM_ID              — 10-character Apple Team ID
 *   APNS_BUNDLE_ID            — iOS app bundle ID
 *                               Default: "com.glev.app" (matches Xcode PRODUCT_BUNDLE_IDENTIFIER)
 *                               ⚠ Do NOT use "app.glev" or "app.glev.app" — those are wrong.
 *
 * Compliance note (D-003): push body contains only the raw glucose value and
 * a generic prompt to check — no dosage instructions, no clinical advice.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const COOLDOWN_MINUTES = 15;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
const DEFAULT_THRESHOLD = 70;
const CGM_LOOKBACK_MINUTES = 10;

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AlarmSettingsRow {
  user_id: string;
  low_alarm_threshold_mgdl: number | null;
}

interface PushTokenRow {
  user_id: string;
  push_token: string;
  push_platform: "ios" | "android";
}

interface UserEntry extends PushTokenRow {
  low_alarm_threshold_mgdl: number | null;
}

interface CooldownRow {
  user_id: string;
  last_sent_at: string;
}

/* ── APNs JWT (ES256 / P-256) ──────────────────────────────────────────── */

let apnsJwtCache: { token: string; expiresAt: number } | null = null;

async function getApnsJwt(
  keyP8: string,
  keyId: string,
  teamId: string,
): Promise<string> {
  const now = Date.now();
  if (apnsJwtCache && apnsJwtCache.expiresAt > now + 60_000) {
    return apnsJwtCache.token;
  }

  const pemBody = keyP8
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const issuedAt = Math.floor(now / 1000);
  const token = await create(
    { alg: "ES256", kid: keyId },
    { iss: teamId, iat: issuedAt, exp: getNumericDate(3600) },
    key,
  );

  apnsJwtCache = { token, expiresAt: now + 3_600_000 };
  return token;
}

/* ── FCM HTTP v1 helpers (replaces the shut-down legacy API) ───────────── */

/**
 * GCP OAuth2 access-token cache.
 * Service account JWTs are valid for 1 hour; we cache and reuse them
 * within a single Edge Function invocation lifetime.
 */
let fcmAccessTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Derive a short-lived GCP OAuth2 access token from a service account JSON.
 * Uses the crypto.subtle RS256 path (RSASSA-PKCS1-v1_5 / SHA-256) because
 * GCP only accepts RS256 JWTs for service-account token exchange.
 */
async function getGcpAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Date.now();
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > now + 60_000) {
    return fcmAccessTokenCache.token;
  }

  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

  // Build the RS256 JWT manually (djwt uses ES256; GCP needs RS256).
  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const rsaKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    rsaKey,
    new TextEncoder().encode(signingInput),
  );
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwtToken = `${signingInput}.${b64sig}`;

  // Exchange the JWT for an access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwtToken}`,
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`GCP OAuth2 token error ${tokenRes.status}: ${txt}`);
  }

  const { access_token, expires_in } = await tokenRes.json() as {
    access_token: string;
    expires_in: number;
  };

  fcmAccessTokenCache = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

/**
 * Send an Android push notification via the Firebase HTTP v1 API.
 * The legacy `fcm.googleapis.com/fcm/send` endpoint was shut down by
 * Google in June 2024 — this replaces it.
 *
 * Required secrets:
 *   FIREBASE_PROJECT_ID          — Firebase project ID string
 *   FIREBASE_SERVICE_ACCOUNT_JSON — Full service account JSON key (one line)
 */
async function sendFcmPushV1(
  serviceAccountJson: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
): Promise<void> {
  const accessToken = await getGcpAccessToken(serviceAccountJson);

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: {
            priority: "high",
            notification: {
              sound: "glev_low_alarm",
              channel_id: "hypo_alarm",
            },
          },
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM v1 error ${res.status}: ${text}`);
  }
}

/* ── APNs send ──────────────────────────────────────────────────────────── */

async function sendApnsPush(
  keyP8: string,
  keyId: string,
  teamId: string,
  bundleId: string,
  token: string,
  title: string,
  body: string,
): Promise<void> {
  const jwt = await getApnsJwt(keyP8, keyId, teamId);

  // api.push.apple.com handles both production (App Store / TestFlight)
  // and sandbox (Xcode direct installs). Use the production endpoint.
  const url = `https://api.push.apple.com/3/device/${token}`;
  const payload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: "glev_low_alarm.wav",
      "content-available": 1,
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-priority": "10",
      "apns-push-type": "alert",
    },
    body: payload,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APNs error ${res.status}: ${text}`);
  }
}

/* ── Main handler ───────────────────────────────────────────────────────── */

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Android (FCM HTTP v1) — legacy FIREBASE_SERVER_KEY is no longer accepted.
  const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
  const firebaseServiceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";

  // iOS (APNs)
  const apnsKeyP8 = Deno.env.get("APNS_KEY_P8") ?? "";
  const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
  const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";
  // PRODUCT_BUNDLE_IDENTIFIER from Xcode is "com.glev.app".
  // Do NOT use "app.glev" (Capacitor appId) or "app.glev.app" (old wrong default).
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "com.glev.app";

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Load push template from DB (fallback to hardcoded defaults)
  let pushTitle = "🔴 Hypo-Alarm · {{value}} mg/dL";
  let pushBody = "Dein BZ liegt bei {{value}} mg/dL — prüf dich jetzt.";
  try {
    const { data: tpl } = await sb
      .from("message_templates")
      .select("push_title, push_body")
      .eq("key", "push_hypo")
      .maybeSingle();
    if (tpl?.push_title) pushTitle = tpl.push_title as string;
    if (tpl?.push_body) pushBody = tpl.push_body as string;
  } catch {
    // use defaults
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - CGM_LOOKBACK_MINUTES * 60 * 1000);
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MS);

  /* 1. Fetch user_ids where alarm is enabled */
  const { data: alarmRows, error: alarmError } = await sb
    .from("user_settings")
    .select("user_id, low_alarm_threshold_mgdl")
    .eq("low_alarm_enabled", true) as {
      data: AlarmSettingsRow[] | null;
      error: { message: string } | null;
    };

  if (alarmError) {
    console.error("[hypo-check] failed to fetch alarm settings:", alarmError.message);
    return new Response(JSON.stringify({ error: alarmError.message }), { status: 500 });
  }
  if (!alarmRows || alarmRows.length === 0) {
    console.log("[hypo-check] no users with alarm enabled");
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  const alarmUserIds = alarmRows.map((r) => r.user_id);
  const alarmByUserId = new Map<string, number | null>(
    alarmRows.map((r) => [r.user_id, r.low_alarm_threshold_mgdl]),
  );

  /* 2. Fetch push tokens for those users */
  const { data: tokenRows, error: tokenError } = await sb
    .from("profiles")
    .select("user_id, push_token, push_platform")
    .in("user_id", alarmUserIds)
    .not("push_token", "is", null)
    .not("push_platform", "is", null) as {
      data: PushTokenRow[] | null;
      error: { message: string } | null;
    };

  if (tokenError) {
    console.error("[hypo-check] failed to fetch push tokens:", tokenError.message);
    return new Response(JSON.stringify({ error: tokenError.message }), { status: 500 });
  }
  if (!tokenRows || tokenRows.length === 0) {
    console.log(
      `[hypo-check] ${alarmRows.length} users have alarm on but none have a push token registered`,
    );
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  /* 3. Build combined user list */
  const users: UserEntry[] = tokenRows.map((r) => ({
    ...r,
    low_alarm_threshold_mgdl: alarmByUserId.get(r.user_id) ?? null,
  }));

  /* 4. Fetch cooldown rows */
  const userIds = users.map((u) => u.user_id);
  const { data: cooldowns } = await sb
    .from("hypo_push_cooldown")
    .select("user_id, last_sent_at")
    .in("user_id", userIds) as { data: CooldownRow[] | null };

  const cooldownMap = new Map<string, Date>(
    (cooldowns ?? []).map((r) => [r.user_id, new Date(r.last_sent_at)]),
  );

  let sent = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      const threshold = user.low_alarm_threshold_mgdl ?? DEFAULT_THRESHOLD;

      /* 5. Check cooldown */
      const lastSent = cooldownMap.get(user.user_id);
      if (lastSent && lastSent > cooldownCutoff) {
        continue;
      }

      /* 6. Get latest CGM value (last 10 minutes) */
      const { data: cgmRows, error: cgmError } = await sb
        .from("cgm_samples")
        .select("value_mgdl, timestamp")
        .eq("user_id", user.user_id)
        .gte("timestamp", cutoff.toISOString())
        .order("timestamp", { ascending: false })
        .limit(1);

      if (cgmError) {
        console.error(`[hypo-check] cgm_samples error for ${user.user_id}:`, cgmError.message);
      }

      const { data: ahRows, error: ahError } = await sb
        .from("apple_health_readings")
        .select("value_mg_dl, timestamp")
        .eq("user_id", user.user_id)
        .gte("timestamp", cutoff.toISOString())
        .order("timestamp", { ascending: false })
        .limit(1);

      if (ahError) {
        console.error(`[hypo-check] apple_health_readings error for ${user.user_id}:`, ahError.message);
      }

      type Reading = { value: number; at: Date };
      const candidates: Reading[] = [];
      if (cgmRows && cgmRows.length > 0) {
        candidates.push({ value: cgmRows[0].value_mgdl, at: new Date(cgmRows[0].timestamp) });
      }
      if (ahRows && ahRows.length > 0) {
        candidates.push({ value: ahRows[0].value_mg_dl, at: new Date(ahRows[0].timestamp) });
      }

      if (candidates.length === 0) {
        console.log(`[hypo-check] no recent CGM data for ${user.user_id}, skipping`);
        continue;
      }

      candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
      const latestValue = candidates[0].value;

      /* 7. Check against threshold */
      if (latestValue >= threshold) continue;

      /* 8. Send push */
      const valueStr = String(Math.round(latestValue));
      const title = pushTitle.replace(/\{\{value\}\}/g, valueStr);
      const body = pushBody.replace(/\{\{value\}\}/g, valueStr);

      if (user.push_platform === "android") {
        if (!firebaseProjectId || !firebaseServiceAccountJson) {
          errors.push(
            `${user.user_id}: FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON not set ` +
            `(legacy FIREBASE_SERVER_KEY was shut down June 2024 — migrate to FCM HTTP v1)`,
          );
          continue;
        }
        await sendFcmPushV1(firebaseServiceAccountJson, firebaseProjectId, user.push_token, title, body);
      } else if (user.push_platform === "ios") {
        if (!apnsKeyP8 || !apnsKeyId || !apnsTeamId) {
          errors.push(
            `${user.user_id}: APNs secrets not set (need APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID)`,
          );
          continue;
        }
        await sendApnsPush(apnsKeyP8, apnsKeyId, apnsTeamId, apnsBundleId, user.push_token, title, body);
      }

      /* 9. Upsert cooldown row */
      await sb
        .from("hypo_push_cooldown")
        .upsert({ user_id: user.user_id, last_sent_at: now.toISOString() });

      sent++;
      console.log(
        `[hypo-check] sent push to ${user.user_id} (${user.push_platform}), ` +
        `value=${latestValue}, threshold=${threshold}, bundle=${user.push_platform === "ios" ? apnsBundleId : firebaseProjectId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${user.user_id}: ${msg}`);
      console.error(`[hypo-check] error for user ${user.user_id}:`, msg);
    }
  }

  console.log(`[hypo-check] done: checked=${users.length}, sent=${sent}, errors=${errors.length}`);
  return new Response(
    JSON.stringify({ checked: users.length, sent, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
