// POST /api/admin/meta/phone-backfill
// Extracts phone numbers from meta_leads.raw.field_data for rows where phone is missing.
// Protected via META_BACKFILL_AUTH Bearer token.

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_FIELD_NAMES = [
  "telefonnummer",
  "phone_number",
  "phone_number_full",
  "phone",
  "mobile_phone",
  "work_phone",
  "handynummer",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPhone(raw: any): string | null {
  const fieldData: unknown[] = Array.isArray(raw?.field_data) ? raw.field_data : [];
  for (const f of fieldData) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const field = f as any;
    const name: string = String(field?.name ?? "").toLowerCase().trim();
    if (!PHONE_FIELD_NAMES.includes(name)) continue;
    const values: unknown[] = Array.isArray(field?.values) ? field.values : [];
    const val = String(values[0] ?? "").trim();
    if (val) return val;
  }
  return null;
}

export async function GET() {
  return Response.json({ ok: true, message: "Use POST to trigger phone backfill" });
}

export async function POST(req: Request) {
  try {
    const META_BACKFILL_AUTH = process.env.META_BACKFILL_AUTH ?? "";
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!META_BACKFILL_AUTH || !token || token !== META_BACKFILL_AUTH) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const { data: leads, error: fetchErr } = await sb
      .from("meta_leads")
      .select("id, email, phone, raw")
      .or("phone.is.null,phone.eq.")
      .not("raw", "is", null);

    if (fetchErr) {
      return Response.json({ error: "fetch_failed", message: fetchErr.message }, { status: 500 });
    }

    let processed = 0;
    let updated = 0;
    const results: { id: string; email: string; phone: string | null; action: string }[] = [];

    for (const lead of leads ?? []) {
      processed++;
      const phone = extractPhone(lead.raw);
      if (!phone) {
        results.push({ id: lead.id, email: lead.email, phone: null, action: "no_phone_found" });
        continue;
      }

      const { error: updateErr } = await sb
        .from("meta_leads")
        .update({ phone })
        .eq("id", lead.id);

      if (updateErr) {
        results.push({ id: lead.id, email: lead.email, phone, action: `update_error: ${updateErr.message}` });
      } else {
        updated++;
        results.push({ id: lead.id, email: lead.email, phone, action: "updated" });
      }
    }

    return Response.json({ ok: true, processed, updated, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "internal_error", message }, { status: 500 });
  }
}
