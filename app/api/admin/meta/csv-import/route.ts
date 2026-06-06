// POST /api/admin/meta/csv-import
// Nimmt eine CSV-Datei (Kommo-Export-Format) als multipart/form-data entgegen,
// provisioniert jeden validen Lead via provisionMetaLead und setzt lead_status
// aus der Stage-Spalte.
//
// Auth: ADMIN_API_SECRET-Header ODER glev_ops_token-Cookie.

import { NextRequest, NextResponse } from "next/server";
import { isAnyAuthed } from "@/lib/adminAuth";
import { provisionMetaLead } from "@/lib/meta-lead-provisioning";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV header names (case-insensitive, trimmed)
const COL_NAME    = ["name", "vollständiger name", "full name"];
const COL_EMAIL   = ["email", "e-mail", "e-mail-adresse"];
const COL_PHONE   = ["phone", "telefon", "telefonnummer"];
const COL_STAGE   = ["stage", "status", "stufe"];

// Kommo Stage → Glev lead_status mapping
const STAGE_MAP: Record<string, string> = {
  "incoming lead":         "incoming",
  "new lead":              "incoming",
  "neuer lead":            "incoming",
  "contacted":             "contacted",
  "kontaktiert":           "contacted",
  "qualified":             "qualified",
  "qualifiziert":          "qualified",
  "in discussion":         "in_discussion",
  "in gespräch":           "in_discussion",
  "proposal sent":         "proposal",
  "angebot gesendet":      "proposal",
  "closed won":            "closed_won",
  "gewonnen":              "closed_won",
  "won":                   "closed_won",
  "closed lost":           "closed_lost",
  "verloren":              "closed_lost",
  "lost":                  "closed_lost",
  "unqualified":           "unqualified",
  "not interested":        "not_interested",
  "kein interesse":        "not_interested",
  "no answer":             "no_answer",
  "keine antwort":         "no_answer",
  "registered":            "registered",
  "registriert":           "registered",
  "trial active":          "trial_active",
  "trial abgelaufen":      "trial_expired",
  "trial expired":         "trial_expired",
  "converted":             "converted",
  "konvertiert":           "converted",
};

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-]/g, "");
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned;
  if (/^0\d{9,14}$/.test(cleaned)) return `+49${cleaned.slice(1)}`;
  return null;
}

function mapStage(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  return STAGE_MAP[lower] ?? lower;
}

function findCol(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  // partial match
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Minimal RFC 4180-compatible CSV parser (handles quoted fields with commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r" && text[i + 1] === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 2;
      } else if (ch === "\n" || ch === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function isTestLead(email: string, name: string): boolean {
  const emailLower = email.toLowerCase();
  const nameLower  = name.toLowerCase();
  return (
    emailLower.includes("test@meta.com") ||
    nameLower.includes("<test lead:")
  );
}

export async function POST(req: NextRequest) {
  // Auth check: ADMIN_API_SECRET header OR cookie
  const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const headerSecret = authHeader.replace(/^Bearer\s+/i, "").trim();
  const headerOk = ADMIN_SECRET && headerSecret === ADMIN_SECRET;
  const cookieOk = headerOk ? true : await isAnyAuthed();

  if (!headerOk && !cookieOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const csvText = await (file as Blob).text();
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 });
  }

  const headers = rows[0];
  const colName  = findCol(headers, COL_NAME);
  const colEmail = findCol(headers, COL_EMAIL);
  const colPhone = findCol(headers, COL_PHONE);
  const colStage = findCol(headers, COL_STAGE);

  if (colEmail === -1) {
    return NextResponse.json({
      error: "Could not find email column. Expected one of: " + COL_EMAIL.join(", "),
      headers,
    }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  let imported        = 0;
  let already_existed = 0;
  let skipped         = 0;
  const errors: { row: number; email: string; reason: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const rawEmail = colEmail !== -1 ? (cols[colEmail] ?? "").trim().toLowerCase() : "";
    const rawName  = colName  !== -1 ? (cols[colName]  ?? "").trim() : "";
    const rawPhone = colPhone !== -1 ? (cols[colPhone] ?? "").trim() : "";
    const rawStage = colStage !== -1 ? (cols[colStage] ?? "").trim() : "";

    // Skip rows without email
    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      skipped++;
      continue;
    }

    // Skip test leads
    if (isTestLead(rawEmail, rawName)) {
      skipped++;
      continue;
    }

    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const leadStatus = rawStage ? mapStage(rawStage) : null;

    try {
      const result = await provisionMetaLead(
        rawEmail,
        rawName || null,
        "de",
        phone ?? undefined,
      );

      if (!result.ok) {
        errors.push({ row: i + 1, email: rawEmail, reason: result.reason });
        continue;
      }

      if (result.created) {
        imported++;
      } else {
        already_existed++;
      }

      // Update lead_status from Stage column if present
      if (leadStatus) {
        await sb
          .from("meta_leads")
          .update({ lead_status: leadStatus })
          .eq("email", rawEmail);
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        email: rawEmail,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    imported,
    already_existed,
    skipped,
    errors,
    total_data_rows: rows.length - 1,
  });
}
