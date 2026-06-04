/**
 * Supabase Edge Function: hyper-check
 *
 * Runs every 5 minutes and sends a push notification to any user whose most
 * recent CGM reading is above their configured high-alarm threshold.
 *
 * Flow per user:
 *   1. Query user_settings for users with high_alarm_enabled = true
 *   2. Cross-reference with profiles to get push_token / push_platform
 *   3. For each user: fetch the latest CGM reading via live source dispatcher
 *      (LLU live API → Nightscout cache/live → Apple Health DB → cgm_samples fallback)
 *   4. Compare against high_alarm_threshold_mgdl (default 180 mg/dL)
 *   5. Check hyper_push_cooldown — skip if last push was < 15 minutes ago
 *   6. Read push title/body from message_templates (key: push_hyper), with {{value}} replacement
 *   7. Send FCM HTTP v1 push (Android) or APNs push (iOS)
 *   8. Upsert the cooldown row
 *
 * Required Supabase Edge Function Secrets (same as hypo-check):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
 *   ENCRYPTION_KEY (64-hex-char, same as Vercel — needed for LLU/Nightscout live fetch)
 *   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_JSON (Android)
 *   APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (iOS)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { fetchLiveReading } from "../_shared/cgm-live.ts";

const COOLDOWN_MINUTES = 15;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
const DEFAULT_THRESHOLD = 180;
const CGM_LOOKBACK_MINUTES = 10;
const CGM_LOOKBACK_MS = CGM_LOOKBACK_MINUTES * 60 * 1000;

const DEFAULT_PUSH_TITLE = "🟠 Hyper-Alarm · {{value}} mg/dL";
const DEFAULT_PUSH_BODY = "Dein BZ liegt bei {{value}} mg/dL — prüf Korrektur und Mahlzeiten.";

interface AlarmSettingsRow {
  user_id: string;
  high_alarm_threshold_mgdl: number | null;
}

interface PushTokenRow {
  user_id: string;
  push_token: string;
  push_platform: "ios" | "android";
}

interface UserEntry extends PushTokenRow {
  high_alarm_threshold_mgdl: number | null;
}

interface CooldownRow {
  user_id: string;
  last_sent_at: string;
}

let apnsJwtCache: { token: string; expiresAt: number } | null = null;

async function getApnsJwt(keyP8: string, keyId: string, teamId: string): Promise<string> {
  const now = Date.now();
  if (apnsJwtCache && apnsJwtCache.expiresAt > now + 60_000) return apnsJwtCache.token;

  const pemBody = keyP8
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
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

let fcmAccessTokenCache: { token: string; expiresAt: number } | null = null;

async function getGcpAccessToken(serviceAccountJson: string): Promise<string> {
  const now = Date.now();
  if (fcmAccessTokenCache && fcmAccessTokenCache.expiresAt > now + 60_000) return fcmAccessTokenCache.token;

  const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: sa.client_email, sub: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat, exp: iat + 3600,
  };
  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const rsaKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKey, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwtToken = `${signingInput}.${b64sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwtToken}`,
  });
  if (!tokenRes.ok) throw new Error(`GCP OAuth2 token error ${tokenRes.status}: ${await tokenRes.text()}`);
  const { access_token, expires_in } = await tokenRes.json() as { access_token: string; expires_in: number };
  fcmAccessTokenCache = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

async function sendFcmPushV1(
  serviceAccountJson: string, projectId: string, token: string, title: string, body: string,
): Promise<void> {
  const accessToken = await getGcpAccessToken(serviceAccountJson);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      message: {
        token, notification: { title, body },
        android: { priority: "high", notification: { sound: "default", channel_id: "hyper_alarm" } },
      },
    }),
  });
  if (!res.ok) throw new Error(`FCM v1 error ${res.status}: ${await res.text()}`);
}

async function sendApnsPush(
  keyP8: string, keyId: string, teamId: string, bundleId: string,
  token: string, title: string, body: string,
): Promise<void> {
  const jwt = await getApnsJwt(keyP8, keyId, teamId);
  const url = `https://api.push.apple.com/3/device/${token}`;
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "glev_high_alarm.wav", badge: 1, "interruption-level": "time-sensitive", "content-available": 1 },
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
  if (!res.ok) throw new Error(`APNs error ${res.status}: ${await res.text()}`);
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const encryptionKey = Deno.env.get("ENCRYPTION_KEY") ?? "";
  const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
  const firebaseServiceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";
  const apnsKeyP8 = Deno.env.get("APNS_KEY_P8") ?? "";
  const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
  const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "com.glev.app";

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date();
  const cutoff = new Date(now.getTime() - CGM_LOOKBACK_MS);
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MS);

  // Load push template from DB (fallback to hardcoded defaults)
  let pushTitle = DEFAULT_PUSH_TITLE;
  let pushBody = DEFAULT_PUSH_BODY;
  try {
    const { data: tpl } = await sb
      .from("message_templates")
      .select("push_title, push_body")
      .eq("key", "push_hyper")
      .maybeSingle();
    if (tpl?.push_title) pushTitle = tpl.push_title as string;
    if (tpl?.push_body) pushBody = tpl.push_body as string;
  } catch {
    // use defaults
  }

  const { data: alarmRows, error: alarmError } = await sb
    .from("user_settings")
    .select("user_id, high_alarm_threshold_mgdl")
    .eq("high_alarm_enabled", true) as { data: AlarmSettingsRow[] | null; error: { message: string } | null };

  if (alarmError) {
    console.error("[hyper-check] failed to fetch alarm settings:", alarmError.message);
    return new Response(JSON.stringify({ error: alarmError.message }), { status: 500 });
  }
  if (!alarmRows || alarmRows.length === 0) {
    console.log("[hyper-check] no users with high alarm enabled");
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  const alarmUserIds = alarmRows.map((r) => r.user_id);
  const alarmByUserId = new Map<string, number | null>(alarmRows.map((r) => [r.user_id, r.high_alarm_threshold_mgdl]));

  const { data: tokenRows, error: tokenError } = await sb
    .from("profiles")
    .select("user_id, push_token, push_platform")
    .in("user_id", alarmUserIds)
    .not("push_token", "is", null)
    .not("push_platform", "is", null) as { data: PushTokenRow[] | null; error: { message: string } | null };

  if (tokenError) {
    console.error("[hyper-check] failed to fetch push tokens:", tokenError.message);
    return new Response(JSON.stringify({ error: tokenError.message }), { status: 500 });
  }
  if (!tokenRows || tokenRows.length === 0) {
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  const users: UserEntry[] = tokenRows.map((r) => ({
    ...r, high_alarm_threshold_mgdl: alarmByUserId.get(r.user_id) ?? null,
  }));

  const userIds = users.map((u) => u.user_id);
  const { data: cooldowns } = await sb
    .from("hyper_push_cooldown")
    .select("user_id, last_sent_at")
    .in("user_id", userIds) as { data: CooldownRow[] | null };

  const cooldownMap = new Map<string, Date>((cooldowns ?? []).map((r) => [r.user_id, new Date(r.last_sent_at)]));

  let sent = 0;
  const errors: string[] = [];

  for (const user of users) {
    const tag = `[hyper-check][${user.user_id}]`;
    try {
      const threshold = user.high_alarm_threshold_mgdl ?? DEFAULT_THRESHOLD;

      const lastSent = cooldownMap.get(user.user_id);
      if (lastSent && lastSent > cooldownCutoff) {
        const minAgo = Math.round((now.getTime() - lastSent.getTime()) / 60000);
        console.log(`${tag} skipped — cooldown active (last sent ${minAgo}min ago)`);
        continue;
      }

      /* Get latest CGM value — live source first, DB fallback second */
      let latestValue: number | null = null;
      let cgmSource = "unknown";

      // Live source dispatcher (LLU / Nightscout / Apple Health)
      try {
        const live = await fetchLiveReading(sb, user.user_id, encryptionKey, CGM_LOOKBACK_MS, tag);
        if (live) {
          latestValue = live.value;
          cgmSource = live.logReason;
          console.log(`${tag} live CGM: source=${live.logReason} value=${live.value}`);
        }
      } catch (liveErr) {
        console.log(`${tag} live fetch error: ${liveErr instanceof Error ? liveErr.message : String(liveErr)}`);
      }

      // DB fallback — cgm_samples (Junction/Vital) and apple_health_readings
      if (latestValue === null) {
        const { data: cgmRows, error: cgmError } = await sb
          .from("cgm_samples")
          .select("value_mgdl, timestamp")
          .eq("user_id", user.user_id)
          .gte("timestamp", cutoff.toISOString())
          .order("timestamp", { ascending: false })
          .limit(1);
        if (cgmError) console.error(`${tag} cgm_samples error:`, cgmError.message);

        const { data: ahRows, error: ahError } = await sb
          .from("apple_health_readings")
          .select("value_mg_dl, timestamp")
          .eq("user_id", user.user_id)
          .gte("timestamp", cutoff.toISOString())
          .order("timestamp", { ascending: false })
          .limit(1);
        if (ahError) console.error(`${tag} apple_health_readings error:`, ahError.message);

        type Reading = { value: number; at: Date; src: string };
        const candidates: Reading[] = [];
        if (cgmRows && cgmRows.length > 0) {
          candidates.push({ value: cgmRows[0].value_mgdl, at: new Date(cgmRows[0].timestamp), src: "cgm_samples" });
        }
        if (ahRows && ahRows.length > 0) {
          candidates.push({ value: ahRows[0].value_mg_dl, at: new Date(ahRows[0].timestamp), src: "apple_health_readings" });
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
          latestValue = candidates[0].value;
          cgmSource = candidates[0].src + "-fallback";
          console.log(`${tag} DB fallback CGM: source=${cgmSource} value=${latestValue}`);
        }
      }

      if (latestValue === null) {
        console.log(`${tag} no recent CGM data (threshold=${threshold}) — skipping`);
        continue;
      }

      if (latestValue <= threshold) {
        console.log(`${tag} value=${latestValue} <= threshold=${threshold} (source=${cgmSource}) — no alarm`);
        continue;
      }

      const valueStr = String(Math.round(latestValue));
      const title = pushTitle.replace(/\{\{value\}\}/g, valueStr);
      const body = pushBody.replace(/\{\{value\}\}/g, valueStr);

      if (user.push_platform === "android") {
        if (!firebaseProjectId || !firebaseServiceAccountJson) {
          errors.push(`${user.user_id}: FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON not set`);
          continue;
        }
        await sendFcmPushV1(firebaseServiceAccountJson, firebaseProjectId, user.push_token, title, body);
      } else if (user.push_platform === "ios") {
        if (!apnsKeyP8 || !apnsKeyId || !apnsTeamId) {
          errors.push(`${user.user_id}: APNs secrets not set`);
          continue;
        }
        await sendApnsPush(apnsKeyP8, apnsKeyId, apnsTeamId, apnsBundleId, user.push_token, title, body);
      }

      await sb.from("hyper_push_cooldown").upsert({ user_id: user.user_id, last_sent_at: now.toISOString() });
      sent++;
      console.log(`${tag} 🟠 ALARM SENT (${user.push_platform}) — value=${latestValue} > threshold=${threshold} source=${cgmSource}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${user.user_id}: ${msg}`);
      console.error(`${tag} error:`, msg);
    }
  }

  console.log(`[hyper-check] done: checked=${users.length}, sent=${sent}, errors=${errors.length}`);
  return new Response(JSON.stringify({ checked: users.length, sent, errors }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
