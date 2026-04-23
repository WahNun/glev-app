import { NextRequest, NextResponse } from "next/server";
import { readAllFromSheet, type SheetRow } from "@/lib/sheets";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY";
const MAX_CHUNKS = 16;

function isAuthed(req: NextRequest): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
  if (!projectRef) return false;
  const cookieName = `sb-${projectRef}-auth-token`;
  const single = req.cookies.get(cookieName)?.value;
  let raw = single ?? null;
  if (!raw) {
    const parts: string[] = [];
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const piece = req.cookies.get(`${cookieName}.${i}`)?.value;
      if (!piece) break;
      parts.push(piece);
    }
    raw = parts.length ? parts.join("") : null;
  }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const session = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!session?.access_token) return false;
    const expiresAt: number = session.expires_at ?? 0;
    return expiresAt > Date.now() / 1000;
  } catch {
    return false;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(row: SheetRow, keys: string[]): string {
  for (const k of keys) {
    const nk = norm(k);
    const match = Object.keys(row).find((h) => norm(h) === nk);
    if (match) return row[match] ?? "";
  }
  return "";
}

function toNumber(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function toNumOrNull(v: string): number | null {
  if (!v || !v.trim()) return null;
  const cleaned = v.replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function toISO(dateStr: string): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.length === 10 ? `${s}T12:00:00Z` : s;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Try DD.MM.YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? "19" : "20") + yyyy;
    const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export interface MappedSheetMeal {
  inputText: string;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  calories: number | null;
  glucoseBefore: number | null;
  glucoseAfter: number | null;
  insulin: number | null;
  evaluation: string;
  mealType: string;
  createdAt: string | null;
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const sheetName = typeof body.sheetName === "string" ? body.sheetName : undefined;

    const rows = await readAllFromSheet({ spreadsheetId: SPREADSHEET_ID, sheetName });

    const mapped: MappedSheetMeal[] = rows.map((r) => {
      const dateStr = pick(r, ["date", "datetime", "timestamp", "day", "when"]);
      const meal = pick(r, ["meal", "food", "description", "item", "notes"]);
      const carbs = toNumber(pick(r, ["carbs", "carbohydrates", "carbgrams", "netcarbs"]));
      const protein = toNumber(pick(r, ["protein", "proteins", "proteingrams"]));
      const fat = toNumber(pick(r, ["fat", "fats", "fatgrams"]));
      const fiber = toNumber(pick(r, ["fiber", "fibre", "fibergrams"]));
      const calsRaw = pick(r, ["calories", "kcal", "cals", "energy"]);
      const calories = calsRaw ? Math.round(toNumber(calsRaw)) : null;
      const glucoseBefore = toNumOrNull(pick(r, ["glucosebefore", "bgbefore", "glucose", "bg", "sugar"]));
      const glucoseAfter = toNumOrNull(pick(r, ["glucoseafter", "bgafter", "postglucose"]));
      const insulin = toNumOrNull(pick(r, ["insulin", "dose", "bolus", "bolusunits", "units"]));
      const evalRaw = pick(r, ["evaluation", "eval", "result", "outcome", "dosequality"]).toUpperCase();
      const evaluation = ["GOOD", "LOW", "HIGH", "SPIKE", "OVERDOSE", "UNDERDOSE"].includes(evalRaw)
        ? evalRaw
        : "GOOD";
      const mealType = pick(r, ["mealtype", "type", "category"]) || "BALANCED";

      return {
        inputText: meal || "Imported from Google Sheets",
        carbs,
        protein,
        fat,
        fiber,
        calories,
        glucoseBefore,
        glucoseAfter,
        insulin,
        evaluation,
        mealType,
        createdAt: toISO(dateStr),
      };
    });

    return NextResponse.json({ read: rows.length, rows: mapped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sheets import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
