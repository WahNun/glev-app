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
 *   6. Send FCM push (Android) or APNs push (iOS)
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
 *   FIREBASE_SERVER_KEY       — FCM server key (Firebase Console → Cloud Messaging)
 *   APNS_KEY_P8               — APNs .p8 private key content (PEM string)
 *   APNS_KEY_ID               — 10-character APNs key ID
 *   APNS_TEAM_ID              — 10-character Apple Team ID
 *   APNS_BUNDLE_ID            — iOS app bundle ID (e.g. "app.glev.app")
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

/** Row from user_settings — alarm config. */
interface AlarmSettingsRow {
  user_id: string;
  low_alarm_threshold_mgdl: number | null;
}

/** Row from profiles — push delivery info. */
interface PushTokenRow {
  user_id: string;
  push_token: string;
  push_platform: "ios" | "android";
}

/** Combined user entry used for sending. */
interface UserEntry extends PushTokenRow {
  low_alarm_threshold_mgdl: number | null;
}

interface CooldownRow {
  user_id: string;
  last_sent_at: string;
}

/* ── APNs JWT ───────────────────────────────────────────────────────────── */

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

/* ── FCM send ───────────────────────────────────────────────────────────── */

async function sendFcmPush(
  serverKey: string,
  token: string,
  title: string,
  body: string,
): Promise<void> {
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${serverKey}`,
    },
    body: JSON.stringify({
      to: token,
      notification: { title, body, sound: "glev_low_alarm" },
      priority: "high",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM error ${res.status}: ${text}`);
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
  const firebaseServerKey = Deno.env.get("FIREBASE_SERVER_KEY") ?? "";
  const apnsKeyP8 = Deno.env.get("APNS_KEY_P8") ?? "";
  const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
  const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "app.glev.app";

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const cutoff = new Date(now.getTime() - CGM_LOOKBACK_MINUTES * 60 * 1000);
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MS);

  /* 1. Fetch user_ids where alarm is enabled (from user_settings) */
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
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  const alarmUserIds = alarmRows.map((r) => r.user_id);
  const alarmByUserId = new Map<string, number | null>(
    alarmRows.map((r) => [r.user_id, r.low_alarm_threshold_mgdl]),
  );

  /* 2. Fetch push tokens for those users (from profiles) */
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
    return new Response(JSON.stringify({ checked: 0, sent: 0 }), { status: 200 });
  }

  /* 3. Build combined user list (alarm on + has push token) */
  const users: UserEntry[] = tokenRows.map((r) => ({
    ...r,
    low_alarm_threshold_mgdl: alarmByUserId.get(r.user_id) ?? null,
  }));

  /* 4. Fetch all cooldown rows for these users in one query */
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
        continue; // still within 15-minute cooldown window
      }

      /* 6. Get latest CGM value (last 10 minutes) */
      // cgm_samples: LLU / Nightscout continuous store (timestamp, value_mgdl)
      const { data: cgmRows, error: cgmError } = await sb
        .from("cgm_samples")
        .select("value_mgdl, timestamp")
        .eq("user_id", user.user_id)
        .gte("timestamp", cutoff.toISOString())
        .order("timestamp", { ascending: false })
        .limit(1);

      if (cgmError) {
        console.error(
          `[hypo-check] cgm_samples query error for ${user.user_id}:`,
          cgmError.message,
        );
      }

      // apple_health_readings: Apple Health push from iOS shell (timestamp, value_mg_dl)
      const { data: ahRows, error: ahError } = await sb
        .from("apple_health_readings")
        .select("value_mg_dl, timestamp")
        .eq("user_id", user.user_id)
        .gte("timestamp", cutoff.toISOString())
        .order("timestamp", { ascending: false })
        .limit(1);

      if (ahError) {
        console.error(
          `[hypo-check] apple_health_readings query error for ${user.user_id}:`,
          ahError.message,
        );
      }

      // Pick the most recent reading from either source
      type Reading = { value: number; at: Date };
      const candidates: Reading[] = [];
      if (cgmRows && cgmRows.length > 0) {
        candidates.push({
          value: cgmRows[0].value_mgdl,
          at: new Date(cgmRows[0].timestamp),
        });
      }
      if (ahRows && ahRows.length > 0) {
        candidates.push({
          value: ahRows[0].value_mg_dl,
          at: new Date(ahRows[0].timestamp),
        });
      }

      if (candidates.length === 0) continue; // no recent CGM data

      candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
      const latestValue = candidates[0].value;

      /* 7. Check against threshold */
      if (latestValue >= threshold) continue;

      /* 8. Send push */
      const title = "⚠️ Glev";
      const body = `Dein BZ liegt bei ${Math.round(latestValue)} mg/dL — prüf dich jetzt.`;

      if (user.push_platform === "android") {
        if (!firebaseServerKey) {
          errors.push(`${user.user_id}: FIREBASE_SERVER_KEY not set`);
          continue;
        }
        await sendFcmPush(firebaseServerKey, user.push_token, title, body);
      } else if (user.push_platform === "ios") {
        if (!apnsKeyP8 || !apnsKeyId || !apnsTeamId) {
          errors.push(`${user.user_id}: APNs secrets not set`);
          continue;
        }
        await sendApnsPush(
          apnsKeyP8,
          apnsKeyId,
          apnsTeamId,
          apnsBundleId,
          user.push_token,
          title,
          body,
        );
      }

      /* 9. Upsert cooldown row */
      await sb
        .from("hypo_push_cooldown")
        .upsert({ user_id: user.user_id, last_sent_at: now.toISOString() });

      sent++;
      console.log(
        `[hypo-check] sent push to ${user.user_id} (${user.push_platform}), value=${latestValue}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${user.user_id}: ${msg}`);
      console.error(`[hypo-check] error for user ${user.user_id}:`, msg);
    }
  }

  return new Response(
    JSON.stringify({ checked: users.length, sent, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
