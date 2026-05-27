/**
 * lib/fb-capi-server.ts
 *
 * Server-side Facebook Conversions API helper.
 * Hashed alle PII-Felder per SHA-256 (Meta-Spec).
 * Verwendet FB_PIXEL_ID + FB_ACCESS_TOKEN aus ENV.
 * FB_TEST_EVENT_CODE optional — vor Go-Live entfernen!
 */
import crypto from "crypto";

const PIXEL_ID      = process.env.FB_PIXEL_ID;
const ACCESS_TOKEN  = process.env.FB_ACCESS_TOKEN;
const TEST_CODE     = process.env.FB_TEST_EVENT_CODE || undefined;
const API_VERSION   = process.env.FB_API_VERSION || "v23.0";
const GRAPH_URL     = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

// ── Normalisierungshelper ──────────────────────────────────────────────────

const hash = (v?: string | null): string | undefined => {
  if (!v) return undefined;
  const t = String(v).trim().toLowerCase();
  if (!t) return undefined;
  return crypto.createHash("sha256").update(t).digest("hex");
};
const hashArr = (v?: string | null): string[] | undefined => {
  const h = hash(v);
  return h ? [h] : undefined;
};

const COUNTRY_CALLING_CODES: Record<string, string> = {
  de: "49", at: "43", ch: "41", us: "1", gb: "44", uk: "44",
  fr: "33", it: "39", es: "34", nl: "31", be: "32", pl: "48",
  cz: "420", dk: "45", se: "46", no: "47", fi: "358",
};

const normPhone = (v?: string | null, country?: string): string | undefined => {
  if (!v) return undefined;
  let d = String(v).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.substring(2);
  else if (d.startsWith("0") && country) {
    const cc = COUNTRY_CALLING_CODES[country.toLowerCase()];
    if (cc) d = cc + d.substring(1);
  }
  d = d.replace(/^0+/, "");
  return d || undefined;
};
const normCompact = (v?: string | null): string | undefined => {
  if (!v) return undefined;
  const o = String(v).trim().toLowerCase().replace(/[\s\-.,]/g, "");
  return o || undefined;
};
const normCountry = (v?: string | null): string | undefined => {
  if (!v) return undefined;
  const c = String(v).trim().toLowerCase();
  return c.length === 2 ? c : undefined;
};

// ── Types ──────────────────────────────────────────────────────────────────

export type MetaLeadFields = Partial<{
  meta_leadgen_id: string;
  meta_campaign: string;
  meta_ad: string;
  meta_lead_form_id: string;
  meta_lead_ad_id: string;
  meta_lead_adset_id: string;
  meta_lead_adset_name: string;
  meta_lead_campaign_id: string;
  meta_lead_platform: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  fbclid: string;
  referrer: string;
}>;

export type CapiUser = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  zip?: string;
  country?: string;
  externalId?: string;
  subscriptionId?: string;
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  clientUserAgent?: string;
};

export type CapiEvent = {
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  eventTime?: number;
  actionSource?: "website" | "system_generated" | "email" | "app";
  value?: number;
  currency?: "EUR" | "USD";
  contentName?: string;
  contentIds?: string[];
  contentType?: "product" | "product_group";
  orderId?: string;
  leadEventSource?: string;
  eventSource?: "crm" | "browser" | "webhook";
  metaLeadFields?: MetaLeadFields;
  customData?: Record<string, unknown>;
};

// ── Haupt-Funktion ─────────────────────────────────────────────────────────

export async function sendCapiEvent(
  user: CapiUser,
  ev: CapiEvent,
): Promise<{ ok: boolean; error?: unknown; response?: unknown }> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn("[CAPI] FB_PIXEL_ID oder FB_ACCESS_TOKEN fehlt — Event übersprungen");
    return { ok: false, error: "missing_env" };
  }

  const user_data: Record<string, unknown> = {
    em:                 hashArr(user.email),
    ph:                 hashArr(normPhone(user.phone, user.country)),
    fn:                 hashArr(user.firstName),
    ln:                 hashArr(user.lastName),
    ct:                 hashArr(normCompact(user.city)),
    zp:                 hashArr(normCompact(user.zip)),
    country:            hashArr(normCountry(user.country)),
    external_id:        hashArr(user.externalId),
    subscription_id:    user.subscriptionId,
    fbp:                user.fbp,
    fbc:                user.fbc,
    client_ip_address:  user.clientIp,
    client_user_agent:  user.clientUserAgent,
  };
  // Leere Felder entfernen — Meta interpretiert undefined-Hashes als Fehler
  Object.keys(user_data).forEach((k) => {
    if (user_data[k] === undefined) delete user_data[k];
  });

  const custom_data: Record<string, unknown> = {
    ...(ev.value !== undefined ? { value: ev.value } : {}),
    ...(ev.currency || ev.value !== undefined ? { currency: ev.currency ?? "EUR" } : {}),
    ...(ev.contentName  ? { content_name: ev.contentName }   : {}),
    ...(ev.contentIds   ? { content_ids:  ev.contentIds }    : {}),
    ...(ev.contentType  ? { content_type: ev.contentType }   : {}),
    ...(ev.orderId      ? { order_id:     ev.orderId }       : {}),
    ...(ev.leadEventSource ? { lead_event_source: ev.leadEventSource } : {}),
    ...(ev.eventSource  ? { event_source: ev.eventSource }   : {}),
    ...(ev.metaLeadFields ?? {}),
    ...(ev.customData   ?? {}),
  };

  const payload: Record<string, unknown> = {
    data: [{
      event_name:       ev.eventName,
      event_time:       ev.eventTime ?? Math.floor(Date.now() / 1000),
      event_id:         ev.eventId,
      event_source_url: ev.eventSourceUrl,
      action_source:    ev.actionSource ?? "website",
      user_data,
      custom_data,
    }],
  };
  if (TEST_CODE) payload.test_event_code = TEST_CODE;

  try {
    const res = await fetch(`${GRAPH_URL}?access_token=${ACCESS_TOKEN}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("[CAPI] API error", json);
      return { ok: false, error: json };
    }
    return { ok: true, response: json };
  } catch (e) {
    console.error("[CAPI] fetch failed", e);
    return { ok: false, error: String(e) };
  }
}
