// POST /api/admin/meta/backfill
// Fetcht alle Leads von der Meta-Seite und provisioniert fehlende Einträge.
// Geschützt via ADMIN_API_SECRET Header.

import { createClient } from "@supabase/supabase-js";
import { provisionMetaLead } from "@/lib/meta-lead-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLeadFields(lead: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fd: any[] = Array.isArray(lead.field_data) ? lead.field_data : [];
  const exact: Record<string, string> = {};
  for (const f of fd) {
    const name = f?.name ?? "";
    const val = Array.isArray(f?.values) ? (f.values[0] ?? "") : (f?.value ?? "");
    if (name && !(name in exact)) exact[name] = val ?? "";
  }
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[äöüß]/g, (m) => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[m] || m));
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
  const explicitFull = getEq("vollständiger_name", "vollstaendiger_name", "full_name", "name");
  const full_name = (first || last ? [first, last].filter(Boolean).join(" ") : explicitFull).trim();
  const email = String(getInc("e-mail-adresse", "email", "emailaddress", "e-mail")).trim().toLowerCase();
  const phone = String(getInc("telefonnummer", "phone_number", "phone_number_full", "phone")).trim();
  const is_test = fd.some((f: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Array.isArray((f as any)?.values) ? (f as any).values : []).some((v: unknown) =>
      String(v).includes("<test lead:"),
    ),
  );
  return { full_name, first_name: first, last_name: last, email, phone, is_test, fields: exact };
}

export async function GET() {
  return Response.json({ ok: true, message: "Use POST to trigger backfill" });
}

export async function POST(req: Request) {
  try {
    const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const secret = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? "";
    const PAGE_ID = (process.env.META_PAGE_ID ?? "").split(",")[0].trim();
    const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION ?? "v23.0"}`;

    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      return Response.json({
        error: "META_PAGE_ACCESS_TOKEN or META_PAGE_ID not configured in Vercel",
      }, { status: 400 });
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // 1. Alle Formulare der Seite abrufen
    const formsUrl = `${GRAPH}/${PAGE_ID}/leadgen_forms?limit=20&access_token=${PAGE_ACCESS_TOKEN}`;
    const formsRes = await fetch(formsUrl);
    const formsJson = await formsRes.json();

    if (!formsRes.ok) {
      return Response.json({
        error: "leadgen_forms_fetch_failed",
        meta_response: formsJson,
        hint: "Token fehlt permissions oder ist abgelaufen",
      }, { status: 200 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forms: { id: string; name: string }[] = (formsJson?.data as any[]) ?? [];
    const results: object[] = [];

    // 2. Für jedes Formular die Leads abrufen
    for (const form of forms) {
      let cursor = `${GRAPH}/${form.id}/leads?fields=${LEAD_FIELDS}&limit=100&access_token=${PAGE_ACCESS_TOKEN}`;
      while (cursor) {
        const leadsRes = await fetch(cursor);
        const leadsJson = await leadsRes.json();

        if (!leadsRes.ok) {
          results.push({ form_id: form.id, form_name: form.name, error: leadsJson });
          break;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const leads: any[] = (leadsJson?.data as any[]) ?? [];

        for (const lead of leads) {
          const mapped = mapLeadFields(lead);
          const row = {
            leadgen_id: String(lead.id),
            page_id: PAGE_ID,
            form_id: lead.form_id ?? form.id,
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

          const { error: upsertErr } = await sb
            .from("meta_leads")
            .upsert(row, { onConflict: "leadgen_id", ignoreDuplicates: true });

          let provisionResult = null;
          if (!mapped.is_test && mapped.email) {
            provisionResult = await provisionMetaLead(mapped.email, mapped.full_name || null, "de");
          }

          results.push({
            leadgen_id: row.leadgen_id,
            email: mapped.email || "(kein email-feld)",
            name: mapped.full_name || "(kein name)",
            is_test: mapped.is_test,
            upsert_error: upsertErr?.message ?? null,
            provision: provisionResult,
          });
        }

        cursor = leadsJson?.paging?.next ?? "";
      }
    }

    return Response.json({
      ok: true,
      forms_found: forms.length,
      leads_processed: results.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "internal_error", message }, { status: 500 });
  }
}
