/**
 * Supabase Edge Function: cgm-ingest-alarm
 *
 * Called immediately whenever a new row is INSERTed into apple_health_readings
 * or nightscout_readings via a Postgres trigger + pg_net (see migration
 * 20260604_cgm_ingest_alarm_trigger.sql).
 *
 * This reduces alarm latency from up to 10 minutes (worst-case 5-min cron gap)
 * to under 1 minute for Apple Health and Nightscout users.
 *
 * The CGM value is taken directly from the INSERT record — no live fetch needed.
 * All three alarm types (hypo, elevated, hyper) are evaluated in one call.
 *
 * Reliability guarantees:
 *   • Backfill / batch-insert guard: the DB trigger's WHEN clause already
 *     filters rows older than 15 min; the edge function adds a belt-and-
 *     suspenders freshness check to handle any residual stale invocations.
 *   • Atomic cooldown: uses try_claim_alarm_cooldown() — a single SQL
 *     INSERT ... ON CONFLICT DO UPDATE WHERE — to prevent duplicate
 *     notifications from concurrent invocations for the same user.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Note for LLU users: LLU readings are never written to                  │
 * │  apple_health_readings or nightscout_readings, so LLU users continue    │
 * │  to rely on the 5-minute cron jobs (hypo-check / elevated-check /       │
 * │  hyper-check). The cron jobs remain the safety net for all users.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Request body (sent by fire_cgm_ingest_alarm Postgres trigger):
 *   {
 *     "table":  "apple_health_readings" | "nightscout_readings",
 *     "record": { "user_id": "...", "value_mg_dl": 72, "timestamp": "...", ... }
 *   }
 *   For nightscout_readings, the value field is "value_mgdl" (no underscore)
 *   and the timestamp field is "recorded_at".
 *
 * Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Response:
 *   { "checked": 1, "triggered": ["hypo"] | [], "errors": [] }
 *
 * Compliance note (D-003): push body contains only the raw glucose value and
 * a generic prompt to check — no dosage instructions, no clinical advice.
 *
 * Required secrets (same as hypo-check / elevated-check / hyper-check):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase runtime
 *   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_JSON — Android FCM HTTP v1
 *   APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID — iOS APNs
 *
 * Deploy:
 *   supabase functions deploy cgm-ingest-alarm
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const COOLDOWN_MINUTES = 15;
/** Belt-and-suspenders freshness window (matches DB trigger WHEN clause). */
const FRESHNESS_MINUTES = 15;
const FRESHNESS_MS = FRESHNESS_MINUTES * 60 * 1000;

/* ── Types ─────────────────────────────────────────────────────────────── */

interface WebhookRecord {
  user_id: string;
  // apple_health_readings columns
  value_mg_dl?: number;
  timestamp?: string;
  // nightscout_readings columns
  value_mgdl?: number;
  recorded_at?: string;
}

interface WebhookPayload {
  table: string;
  record: WebhookRecord;
}

interface AlarmSettings {
  low_alarm_enabled: boolean;
  low_alarm_threshold_mgdl: number | null;
  elevated_alarm_enabled: boolean;
  elevated_alarm_threshold_mgdl: number | null;
  high_alarm_enabled: boolean;
  high_alarm_threshold_mgdl: number | null;
  notif_critical_alerts: boolean | null;
}

interface PushTokenRow {
  push_token: string;
  push_platform: "ios" | "android";
}

type AlarmType = "hypo" | "elevated" | "hyper";

/* ── APNs JWT (ES256 / P-256) ──────────────────────────────────────────── */

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

/* ── FCM HTTP v1 ───────────────────────────────────────────────────────── */

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

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${b64sig}`,
  });
  if (!tokenRes.ok) throw new Error(`GCP OAuth2 token error ${tokenRes.status}: ${await tokenRes.text()}`);
  const { access_token, expires_in } = await tokenRes.json() as { access_token: string; expires_in: number };
  fcmAccessTokenCache = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

async function sendFcmPushV1(
  serviceAccountJson: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  channelId: string,
  sound: string,
): Promise<void> {
  const accessToken = await getGcpAccessToken(serviceAccountJson);
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          android: { priority: "high", notification: { sound, channel_id: channelId } },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`FCM v1 error ${res.status}: ${await res.text()}`);
}

/* ── APNs ───────────────────────────────────────────────────────────────── */

async function sendApnsPush(
  keyP8: string,
  keyId: string,
  teamId: string,
  bundleId: string,
  token: string,
  title: string,
  body: string,
  sound: string,
  interruptionLevel: "critical" | "time-sensitive" = "time-sensitive",
): Promise<void> {
  const jwt = await getApnsJwt(keyP8, keyId, teamId);
  // Critical Alerts require sound as a dictionary with critical:1 so iOS
  // bypasses silent mode and DnD. A plain string is ignored for critical level.
  const soundPayload = interruptionLevel === "critical"
    ? { critical: 1, name: sound, volume: 1.0 }
    : sound;
  const res = await fetch(`https://api.push.apple.com/3/device/${token}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-priority": "10",
      "apns-push-type": "alert",
    },
    body: JSON.stringify({
      aps: {
        alert: { title, body },
        sound: soundPayload,
        badge: 1,
        "interruption-level": interruptionLevel,
        "content-available": 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`APNs error ${res.status}: ${await res.text()}`);
}

/* ── Alarm configuration ─────────────────────────────────────────────────── */

interface AlarmConfig {
  type: AlarmType;
  enabled: boolean;
  threshold: number;
  defaultThreshold: number;
  cooldownTable: string;
  templateKey: string;
  defaultTitle: string;
  defaultBody: string;
  fcmSound: string;
  fcmChannelId: string;
  apnsSound: string;
  exceedsFn: (value: number, threshold: number) => boolean;
}

function buildAlarmConfigs(settings: AlarmSettings): AlarmConfig[] {
  return [
    {
      type: "hypo",
      enabled: settings.low_alarm_enabled,
      threshold: settings.low_alarm_threshold_mgdl ?? 70,
      defaultThreshold: 70,
      cooldownTable: "hypo_push_cooldown",
      templateKey: "push_hypo",
      defaultTitle: "🔴 Hypo-Alarm · {{value}} mg/dL",
      defaultBody: "Dein BZ liegt bei {{value}} mg/dL — prüf dich jetzt.",
      fcmSound: "glev_low_alarm",
      fcmChannelId: "hypo_alarm",
      apnsSound: "glev_low_alarm.wav",
      exceedsFn: (v, t) => v < t,
    },
    {
      type: "elevated",
      enabled: settings.elevated_alarm_enabled,
      threshold: settings.elevated_alarm_threshold_mgdl ?? 140,
      defaultThreshold: 140,
      cooldownTable: "elevated_push_cooldown",
      templateKey: "push_elevated",
      defaultTitle: "🟡 Erhöhter BZ · {{value}} mg/dL",
      defaultBody: "Dein BZ liegt bei {{value}} mg/dL — behalte ihn im Auge.",
      fcmSound: "default",
      fcmChannelId: "elevated_alarm",
      apnsSound: "glev_elevated.wav",
      exceedsFn: (v, t) => v > t,
    },
    {
      type: "hyper",
      enabled: settings.high_alarm_enabled,
      threshold: settings.high_alarm_threshold_mgdl ?? 180,
      defaultThreshold: 180,
      cooldownTable: "hyper_push_cooldown",
      templateKey: "push_hyper",
      defaultTitle: "🟠 Hyper-Alarm · {{value}} mg/dL",
      defaultBody: "Dein BZ liegt bei {{value}} mg/dL — prüf Korrektur und Mahlzeiten.",
      fcmSound: "default",
      fcmChannelId: "hyper_alarm",
      apnsSound: "glev_high_alarm.wav",
      exceedsFn: (v, t) => v > t,
    },
  ];
}

/* ── Main handler ───────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
  const firebaseServiceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";
  const apnsKeyP8 = Deno.env.get("APNS_KEY_P8") ?? "";
  const apnsKeyId = Deno.env.get("APNS_KEY_ID") ?? "";
  const apnsTeamId = Deno.env.get("APNS_TEAM_ID") ?? "";
  const apnsBundleId = Deno.env.get("APNS_BUNDLE_ID") ?? "com.glev.app";

  /* ── Auth ────────────────────────────────────────────────────────────── */
  const authHeader = req.headers.get("Authorization") ?? "";
  const incomingToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!serviceRoleKey || incomingToken !== serviceRoleKey) {
    console.warn("[cgm-ingest-alarm] unauthorized request — token mismatch");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  /* ── Parse body ──────────────────────────────────────────────────────── */
  let payload: WebhookPayload;
  try {
    payload = await req.json() as WebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  const record = payload?.record;
  const tableName = payload?.table ?? "unknown";
  const userId = record?.user_id;

  if (!userId) {
    console.warn("[cgm-ingest-alarm] missing user_id in record from table:", tableName);
    return new Response(JSON.stringify({ error: "missing user_id" }), { status: 400 });
  }

  /* ── Belt-and-suspenders freshness guard ─────────────────────────────── */
  // The DB trigger WHEN clause already filters rows older than 15 min, but
  // edge function invocations can be slightly delayed. Guard again here to
  // ensure we never send alarms for stale/historical readings.
  const recordTimestamp = record.timestamp ?? record.recorded_at ?? null;
  if (recordTimestamp) {
    const recordMs = new Date(recordTimestamp).getTime();
    if (isNaN(recordMs) || Date.now() - recordMs > FRESHNESS_MS) {
      console.log(
        `[cgm-ingest-alarm][${userId}] record from ${tableName} is stale ` +
        `(timestamp=${recordTimestamp}) — skipping`,
      );
      return new Response(JSON.stringify({ checked: 0, triggered: [], errors: [] }), { status: 200 });
    }
  }

  // Extract CGM value — column name differs between tables
  const cgmValue = record.value_mg_dl ?? record.value_mgdl ?? null;
  if (cgmValue === null || typeof cgmValue !== "number") {
    console.log(`[cgm-ingest-alarm][${userId}] no numeric CGM value in record from ${tableName} — skipping`);
    return new Response(JSON.stringify({ checked: 0, triggered: [], errors: [] }), { status: 200 });
  }

  const tag = `[cgm-ingest-alarm][${userId}]`;
  console.log(`${tag} received value=${cgmValue} from table=${tableName}`);

  const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  /* ── Load alarm settings ─────────────────────────────────────────────── */
  const { data: settingsData, error: settingsError } = await sb
    .from("user_settings")
    .select(
      "low_alarm_enabled, low_alarm_threshold_mgdl, " +
      "elevated_alarm_enabled, elevated_alarm_threshold_mgdl, " +
      "high_alarm_enabled, high_alarm_threshold_mgdl, " +
      "notif_critical_alerts",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) {
    console.error(`${tag} failed to fetch alarm settings:`, settingsError.message);
    return new Response(JSON.stringify({ error: settingsError.message }), { status: 500 });
  }

  if (!settingsData) {
    console.log(`${tag} no user_settings row — no alarms configured, skipping`);
    return new Response(JSON.stringify({ checked: 1, triggered: [], errors: [] }), { status: 200 });
  }

  const settings = settingsData as AlarmSettings;
  const criticalEnabled = settings.notif_critical_alerts === true;
  const interruptionLevel: "critical" | "time-sensitive" = criticalEnabled ? "critical" : "time-sensitive";
  const alarmConfigs = buildAlarmConfigs(settings);
  const enabledAlarms = alarmConfigs.filter((a) => a.enabled && a.exceedsFn(cgmValue, a.threshold));

  if (enabledAlarms.length === 0) {
    console.log(`${tag} value=${cgmValue} within all thresholds or all alarms disabled`);
    return new Response(JSON.stringify({ checked: 1, triggered: [], errors: [] }), { status: 200 });
  }

  /* ── Load push token ─────────────────────────────────────────────────── */
  const { data: tokenData, error: tokenError } = await sb
    .from("profiles")
    .select("push_token, push_platform")
    .eq("user_id", userId)
    .not("push_token", "is", null)
    .not("push_platform", "is", null)
    .maybeSingle();

  if (tokenError) {
    console.error(`${tag} failed to fetch push token:`, tokenError.message);
    return new Response(JSON.stringify({ error: tokenError.message }), { status: 500 });
  }

  if (!tokenData) {
    console.log(`${tag} no push token registered — alarms would fire but cannot deliver`);
    return new Response(JSON.stringify({ checked: 1, triggered: [], errors: [] }), { status: 200 });
  }

  const pushRow = tokenData as PushTokenRow;

  /* ── Load push templates (best-effort, falls back to defaults) ───────── */
  const templateMap = new Map<string, { title: string; body: string }>();
  try {
    const templateKeys = enabledAlarms.map((a) => a.templateKey);
    const { data: tplRows } = await sb
      .from("message_templates")
      .select("key, push_title, push_body")
      .in("key", templateKeys);

    if (tplRows) {
      for (const row of tplRows as Array<{ key: string; push_title?: string; push_body?: string }>) {
        templateMap.set(row.key, {
          title: row.push_title ?? "",
          body: row.push_body ?? "",
        });
      }
    }
  } catch {
    // use defaults
  }

  const triggered: AlarmType[] = [];
  const errors: string[] = [];

  for (const alarm of enabledAlarms) {
    /* ── Atomic cooldown claim ──────────────────────────────────────── */
    // try_claim_alarm_cooldown() uses a single INSERT ... ON CONFLICT DO
    // UPDATE ... WHERE to atomically claim the slot. Returns true only if
    // this invocation won the race; false = cooldown still active or another
    // concurrent call already claimed it.
    const { data: claimed, error: cooldownError } = await sb.rpc(
      "try_claim_alarm_cooldown",
      {
        p_user_id: userId,
        p_cooldown_table: alarm.cooldownTable,
        p_cooldown_minutes: COOLDOWN_MINUTES,
      },
    );

    if (cooldownError) {
      console.error(`${tag} [${alarm.type}] cooldown RPC error:`, cooldownError.message);
      errors.push(`${alarm.type}: cooldown check failed — ${cooldownError.message}`);
      continue;
    }

    if (!claimed) {
      console.log(`${tag} [${alarm.type}] skipped — cooldown active or race lost`);
      continue;
    }

    /* ── Attempt push delivery ──────────────────────────────────────── */
    // Cooldown is now claimed. IMPORTANT: on ANY delivery failure we must
    // call release_alarm_cooldown() to undo the claim so the 5-minute cron
    // safety net can still deliver the alarm in the next cycle.

    const tpl = templateMap.get(alarm.templateKey);
    const valueStr = String(Math.round(cgmValue));
    const title = (tpl?.title || alarm.defaultTitle).replace(/\{\{value\}\}/g, valueStr);
    const body = (tpl?.body || alarm.defaultBody).replace(/\{\{value\}\}/g, valueStr);

    let pushDelivered = false;
    let deliveryError = "";

    try {
      if (pushRow.push_platform === "android") {
        if (!firebaseProjectId || !firebaseServiceAccountJson) {
          deliveryError = "FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT_JSON not set";
        } else {
          await sendFcmPushV1(
            firebaseServiceAccountJson, firebaseProjectId, pushRow.push_token,
            title, body, alarm.fcmChannelId, alarm.fcmSound,
          );
          pushDelivered = true;
        }
      } else if (pushRow.push_platform === "ios") {
        if (!apnsKeyP8 || !apnsKeyId || !apnsTeamId) {
          deliveryError = "APNs secrets not set (need APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID)";
        } else {
          await sendApnsPush(
            apnsKeyP8, apnsKeyId, apnsTeamId, apnsBundleId,
            pushRow.push_token, title, body, alarm.apnsSound,
            interruptionLevel,
          );
          pushDelivered = true;
        }
      } else {
        deliveryError = `unknown push platform: ${pushRow.push_platform}`;
      }
    } catch (err) {
      deliveryError = err instanceof Error ? err.message : String(err);
      console.error(`${tag} [${alarm.type}] push delivery error:`, deliveryError);
    }

    if (!pushDelivered) {
      // Release the claimed cooldown so the 5-minute cron can retry delivery.
      errors.push(`${alarm.type}: ${deliveryError}`);
      try {
        await sb.rpc("release_alarm_cooldown", {
          p_user_id: userId,
          p_cooldown_table: alarm.cooldownTable,
        });
        console.log(
          `${tag} [${alarm.type}] cooldown released after delivery failure — cron can retry. error=${deliveryError}`,
        );
      } catch (releaseErr) {
        console.error(
          `${tag} [${alarm.type}] WARN: failed to release cooldown after delivery failure:`,
          releaseErr,
        );
      }
      continue;
    }

    triggered.push(alarm.type);
    console.log(
      `${tag} ⚡ ${alarm.type.toUpperCase()} ALARM SENT (${pushRow.push_platform}) — ` +
      `value=${cgmValue} threshold=${alarm.threshold} table=${tableName}`,
    );
  }

  console.log(`${tag} done: triggered=[${triggered.join(",")}] errors=${errors.length}`);
  return new Response(
    JSON.stringify({ checked: 1, triggered, errors }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
