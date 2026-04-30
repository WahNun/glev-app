import { NextRequest, NextResponse } from "next/server";
import { readAllFromSheet, type SheetRow } from "@/lib/sheets";
import { enrichMacrosBatch } from "@/lib/macroEnrich";

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
  /** Outcome label from the source sheet — `null` when the column is
   *  missing or holds a value we don't recognise. We never invent
   *  "GOOD" any more; the unified evaluator (`lifecycleFor`) fills
   *  the row in on first read instead. */
  evaluation: string | null;
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
      // Task #15: import never pre-sets `evaluation`. The unified
      // `lifecycleFor` evaluator is the only legitimate writer of that
      // column — even sheet-supplied outcome labels would bypass the
      // ±30 min window guard and the unified resolver, so they are
      // dropped on the floor. The row goes in as NULL and the lifecycle
      // assigns its bucket on first read.
      const evaluation = null;
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

    // Enrich rows that have a meal description but are missing macros (no
    // protein AND no fat AND no fiber from the source sheet). Uses OpenAI to
    // estimate from the ingredient list given the known carb total.
    const needsEnrichment = (m: MappedSheetMeal) =>
      !!m.inputText &&
      m.inputText !== "Imported from Google Sheets" &&
      m.protein === 0 && m.fat === 0 && m.fiber === 0;

    let enrichedCount = 0;
    if (mapped.some(needsEnrichment)) {
      const estimates = await enrichMacrosBatch(mapped, needsEnrichment, 4);
      for (const [idx, est] of estimates) {
        mapped[idx] = {
          ...mapped[idx],
          protein: est.protein,
          fat: est.fat,
          fiber: est.fiber,
          calories: mapped[idx].calories ?? est.calories,
        };
        enrichedCount++;
      }
    }

    return NextResponse.json({ read: rows.length, enriched: enrichedCount, rows: mapped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sheets import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
