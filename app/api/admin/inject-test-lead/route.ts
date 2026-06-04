/**
 * POST /api/admin/inject-test-lead
 *
 * Injiziert einen synthetischen Test-Lead in die meta_leads-Tabelle und
 * triggert den KOMPLETTEN Downstream-Flow (Welcome-Email + Welcome-SMS,
 * Profile-Creation, Reminder-Eligibility) — ohne das echte Meta-Formular
 * zu nutzen (kein CPL-Drift).
 *
 * Auth: Admin-Cookie (isAdminAuthed).
 * Idempotent bei gleicher E-Mail: 409 Conflict.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { provisionMetaLead } from "@/lib/meta-lead-provisioning";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");

/** Normalises a phone number to E.164 if it starts with 0 (German local). */
function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").replace(/-/g, "");
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned;
  if (/^0\d{9,14}$/.test(cleaned)) return `+49${cleaned.slice(1)}`;
  return null;
}

export async function POST(req: NextRequest) {
  const authed = await isAdminAuthed();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const phoneRaw = String(body.phone ?? "").trim();
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;

  // Validate email
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Ungültige E-Mail-Adresse." }, { status: 400 });
  }

  // Validate phone (required for full journey test)
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) {
    return NextResponse.json(
      { error: "Ungültiges Telefon-Format. Bitte E.164 verwenden (+4917612345678) oder leer lassen." },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();

  // Idempotency check: email already in meta_leads?
  const { data: existing } = await sb
    .from("meta_leads")
    .select("id, is_synthetic_test")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error: `Lead existiert bereits in meta_leads (ID: ${existing.id}, synthetic: ${existing.is_synthetic_test ?? false}). Bitte erst löschen wenn du re-injecten willst.`,
        leadId: existing.id,
      },
      { status: 409 },
    );
  }

  // Trigger the COMPLETE downstream flow via the shared provisioning utility.
  // This creates the auth user (or sends recovery link), upserts the profile,
  // inserts into meta_leads, and sends Welcome-Email + Welcome-SMS.
  const result = await provisionMetaLead(email, name, "de", phone ?? undefined);

  if (!result.ok) {
    return NextResponse.json(
      { error: `Provisioning fehlgeschlagen: ${result.reason}` },
      { status: 500 },
    );
  }

  // Mark the new meta_leads row as synthetic so it's excluded from real stats.
  const { data: leadRow } = await sb
    .from("meta_leads")
    .update({ is_synthetic_test: true })
    .eq("email", email)
    .select("id")
    .maybeSingle();

  const leadId = leadRow?.id ?? null;
  const crmUrl = `${APP_URL}/glev-ops/crm`;

  return NextResponse.json({
    ok: true,
    userId: result.userId,
    created: result.created,
    leadId,
    crmUrl,
    message: result.created
      ? "Neuer Account + Lead angelegt. Welcome-Email + SMS unterwegs."
      : "Bestehender Account — Recovery-Link generiert. Lead-Eintrag angelegt.",
  });
}
