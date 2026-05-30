// POST /api/meta/leads  — Meta Lead Ads Webhook
// GET  /api/meta/leads  — Webhook-Verifizierung durch Meta
//
// Meta ruft diesen Endpunkt auf, sobald jemand ein Lead-Formular auf
// Facebook oder Instagram absendet. Der Handler:
//   1. prüft die Echtheit per X-Hub-Signature-256 (HMAC-SHA256),
//   2. holt die vollständigen Lead-Daten über die Graph API,
//   3. normalisiert Name / E-Mail / Telefon (DE + EN Feldnamen),
//   4. schreibt den Lead per Upsert in `meta_leads` (Deduplizierung via leadgen_id),
//   5. feuert optional einen Notify-Webhook (z. B. Slack / Mail-Relay).
//
// Webhook-URL: https://glev.app/api/meta/leads
//
// Erforderliche Vercel Environment Variables:
//   META_VERIFY_TOKEN          — frei wählbarer String, muss in Meta-App-Einstellungen hinterlegt werden
//   META_APP_SECRET            — App-Secret der Meta-App (für Signaturprüfung)
//   META_PAGE_ACCESS_TOKEN     — Long-Lived Page Access Token
//   META_PAGE_ID               — Facebook-Seiten-ID (kommagetrennt für mehrere)
//   GRAPH_API_VERSION          — z. B. "v23.0" (optional, Default: v23.0)
//   LEAD_NOTIFY_WEBHOOK        — optional: Slack/Mail-Relay-URL für neue-Lead-Benachrichtigung
//   SUPABASE_SERVICE_ROLE_KEY  — Service-Role-Key (nicht der Anon-Key!)
//
// Doku: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";
const SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN ?? "";
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? "";
const PAGE_ALLOWLIST = (process.env.META_PAGE_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION ?? "v23.0"}`;
const NOTIFY_WEBHOOK = process.env.LEAD_NOTIFY_WEBHOOK ?? "";
const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function verifySignature(rawBody: string, header: string | null): boolean {
  if (!APP_SECRET) return true; // Signaturprüfung nur wenn Secret gesetzt
  if (!header || !header.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLeadFields(lead: any) {
  const fd: any[] = Array.isArray(lead.field_data) ? lead.field_data : [];
  const exact: Record<string, string> = {};
  for (const f of fd) {
    const name = f?.name ?? "";
    const val = Array.isArray(f?.values)
      ? (f.values[0] ?? "")
      : (f?.value ?? "");
    if (name && !(name in exact)) exact[name] = val ?? "";
  }
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(
        /[äöüß]/g,
        (m) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[m] || m),
      );
  const getEq = (...names: string[]) => {
    for (const n of names) if (n in exact) return exact[n];
    const keys = Object.keys(exact);
    for (const n of names) {
      const h = keys.find((k) => norm(k) === norm(n));
      if (h) return exact[h];
    }
    return "";
  };
  const getInc = (...names: string[]) => {
    const eq = getEq(...names);
    if (eq) return eq;
    const keys = Object.keys(exact);
    for (const n of names) {
      const h = keys.find((k) => norm(k).includes(norm(n)));
      if (h) return exact[h];
    }
    return "";
  };
  const first = getEq("first_name", "vorname");
  const last = getEq("last_name", "nachname");
  const explicitFull = getEq(
    "vollständiger_name",
    "vollstaendiger_name",
    "full_name",
    "name",
  );
  const full_name = (
    first || last ? [first, last].filter(Boolean).join(" ") : explicitFull
  ).trim();
  const email = String(
    getInc("e-mail-adresse", "email", "emailaddress", "e-mail"),
  )
    .trim()
    .toLowerCase();
  const phone = String(
    getInc(
      "telefonnummer",
      "phone_number",
      "phone_number_full",
      "phone",
    ),
  ).trim();
  const is_test = fd.some((f) =>
    (Array.isArray(f?.values) ? f.values : []).some((v: unknown) =>
      String(v).includes("<test lead:"),
    ),
  );
  return { full_name, first_name: first, last_name: last, email, phone, is_test, fields: exact };
}

const pageTokenCache = new Map<string, string>();
async function resolvePageToken(pageId: string): Promise<string> {
  if (PAGE_ACCESS_TOKEN) return PAGE_ACCESS_TOKEN;
  if (pageTokenCache.has(pageId)) return pageTokenCache.get(pageId)!;
  if (!SYSTEM_USER_TOKEN)
    throw new Error(
      "No META_PAGE_ACCESS_TOKEN and no META_SYSTEM_USER_TOKEN",
    );
  const res = await fetch(`${GRAPH}/${pageId}?fields=access_token`, {
    headers: { Authorization: `Bearer ${SYSTEM_USER_TOKEN}` },
  });
  const json = await res.json();
  if (!res.ok || !json?.access_token)
    throw new Error(`page token lookup failed: ${JSON.stringify(json)}`);
  pageTokenCache.set(pageId, json.access_token);
  return json.access_token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processChange(value: any, pageId: string) {
  const leadgenId = String(value?.leadgen_id ?? "");
  if (!leadgenId) return;
  if (PAGE_ALLOWLIST.length && pageId && !PAGE_ALLOWLIST.includes(pageId))
    return;
  const token = await resolvePageToken(pageId);
  const res = await fetch(`${GRAPH}/${leadgenId}?fields=${LEAD_FIELDS}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const lead = await res.json();
  if (!res.ok)
    throw new Error(`lead fetch failed: ${JSON.stringify(lead)}`);
  const mapped = mapLeadFields(lead);
  const row = {
    leadgen_id: String(lead.id ?? leadgenId),
    page_id: pageId || null,
    form_id: lead.form_id ?? value?.form_id ?? null,
    ad_id: lead.ad_id ?? null,
    ad_name: lead.ad_name ?? null,
    adset_id: lead.adset_id ?? null,
    adset_name: lead.adset_name ?? null,
    campaign_id: lead.campaign_id ?? null,
    campaign_name: lead.campaign_name ?? null,
    platform: lead.platform ?? null,
    ...mapped,
    field_data: lead.field_data ?? null,
    raw: lead,
    created_time: lead.created_time ?? null,
  };
  const { error } = await sb
    .from("meta_leads")
    .upsert(row, { onConflict: "leadgen_id", ignoreDuplicates: true });
  if (error) throw error;
  if (NOTIFY_WEBHOOK) {
    const text = `Neuer Meta Lead\nName: ${row.full_name || "-"}\nE-Mail: ${row.email || "-"}\nTelefon: ${row.phone || "-"}\nLead-ID: ${row.leadgen_id}`;
    fetch(NOTIFY_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lead: row }),
    }).catch(() => {});
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  if (body?.object === "page" && Array.isArray(body.entry)) {
    const jobs: Promise<void>[] = [];
    for (const entry of body.entry) {
      const pageId = String(entry?.id ?? "");
      for (const change of entry?.changes ?? []) {
        if (change?.field === "leadgen" && change?.value) {
          jobs.push(
            processChange(change.value, pageId).catch((e) =>
              console.error("[meta/leads]", e),
            ),
          );
        }
      }
    }
    await Promise.allSettled(jobs);
  }

  return new Response("EVENT_RECEIVED", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
