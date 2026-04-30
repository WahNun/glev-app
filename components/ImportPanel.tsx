"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { saveMeal, classifyMeal, computeCalories } from "@/lib/meals";
import { logDebug } from "@/lib/debug";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="var(--surface)", BORDER="var(--border)";

interface ParsedRow {
  date: string;
  meal: string;
  glucose: string;
  carbs: string;
  insulin: string;
  evaluation: string;
  protein: string;
  fat: string;
  fiber: string;
  calories: string;
}

function parseNumberLike(val: string): string {
  if (!val) return "";
  const cleaned = val.replace(/[^0-9.\-–—\s]/g, "").trim();
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const avg = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
    return Math.round(avg * 10) / 10 + "";
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? "" : cleaned;
}

function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function mapHeader(h: string): keyof ParsedRow | null {
  if (/^(carbs?|carbohydrates?|carbs_grams|carbgrams|netcarbs)$/.test(h)) return "carbs";
  if (/^(protein|proteins|proteingrams|protein_g)$/.test(h)) return "protein";
  if (/^(fat|fats|fatgrams|fat_g)$/.test(h)) return "fat";
  if (/^(fiber|fibre|fibergrams|fiber_g)$/.test(h)) return "fiber";
  if (/^(calories|kcal|cals|energy)$/.test(h)) return "calories";
  if (/^(insulin|dose|bolus|units|insulinunits|bolusunits)$/.test(h)) return "insulin";
  if (/^(glucose|bg|sugar|bloodglucose|glucosebefore|bg_before)$/.test(h)) return "glucose";
  if (/^(evaluation|eval|result|outcome|dose_quality)$/.test(h)) return "evaluation";
  if (/^(date|datetime|timestamp|createdat|logdate|when)$/.test(h)) return "date";
  if (/^(meal|food|description|input|item|name|notes)$/.test(h)) return "meal";
  if (h.includes("carb")) return "carbs";
  if (h.includes("protein")) return "protein";
  if (h.includes("fat")) return "fat";
  if (h.includes("fiber") || h.includes("fibre")) return "fiber";
  if (h.includes("calor") || h.includes("kcal")) return "calories";
  if (h.includes("insulin") || h.includes("dose") || h.includes("bolus")) return "insulin";
  if (h.includes("glucose") || h.includes("sugar") || h === "bg") return "glucose";
  if (h.includes("eval") || h.includes("result")) return "evaluation";
  if (h.includes("date") || h.includes("time")) return "date";
  if (h.includes("meal") || h.includes("food") || h.includes("desc")) return "meal";
  return null;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]).map(normalizeHeader);

  const colMap: Partial<Record<keyof ParsedRow, number>> = {};
  headers.forEach((h, i) => {
    const field = mapHeader(h);
    if (field && colMap[field] === undefined) colMap[field] = i;
  });

  return lines.slice(1).map(line => {
    const cells = splitCSVLine(line);
    const get = (k: keyof ParsedRow) => {
      const idx = colMap[k];
      return idx !== undefined ? (cells[idx] ?? "") : "";
    };
    return {
      date:       get("date"),
      meal:       get("meal"),
      glucose:    parseNumberLike(get("glucose")),
      carbs:      parseNumberLike(get("carbs")),
      insulin:    parseNumberLike(get("insulin")),
      evaluation: get("evaluation"),
      protein:    parseNumberLike(get("protein")),
      fat:        parseNumberLike(get("fat")),
      fiber:      parseNumberLike(get("fiber")),
      calories:   parseNumberLike(get("calories")),
    };
  }).filter(r => r.meal || r.carbs);
}

function toISO(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const s = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.length === 10 ? `${s}T12:00:00Z` : s;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function ImportPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("import");
  const [csv, setCSV]         = useState("");
  const [rows, setRows]       = useState<ParsedRow[]>([]);
  const [parsed, setParsed]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported]   = useState(0);
  const [errors, setErrors]   = useState<string[]>([]);
  const [done, setDone]       = useState(false);
  const [sheetsRunning, setSheetsRunning] = useState(false);
  const [sheetsResult, setSheetsResult]   = useState<{ read?: number; inserted?: number; errors?: string[]; error?: string } | null>(null);

  async function handleSheetsImport() {
    setSheetsRunning(true);
    setSheetsResult(null);
    try {
      const res = await fetch("/api/import/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSheetsResult({ error: data.error || `HTTP ${res.status}` });
        setSheetsRunning(false);
        return;
      }
      const sheetRows = (data.rows || []) as Array<{
        inputText: string; carbs: number; protein: number; fat: number; fiber: number;
        calories: number | null; glucoseBefore: number | null; glucoseAfter: number | null;
        insulin: number | null; evaluation: string; mealType: string; createdAt: string | null;
      }>;
      let inserted = 0;
      const errs: string[] = [];
      for (const r of sheetRows) {
        try {
          const cals = r.calories ?? computeCalories(r.carbs, r.protein, r.fat);
          // Task #15: the unified `lifecycleFor` evaluator is the ONLY
          // legitimate writer of `evaluation`. Even when the source sheet
          // carries a recognised outcome label, we no longer trust it at
          // import time — pre-set values silently break the "evaluation
          // is only `final` when readings + window pass" invariant. The
          // row goes in with `evaluation: null` and lifecycleFor fills
          // it on first read once bg_2h (with valid timestamps) lands.
          const mt = r.mealType && r.mealType !== "BALANCED" ? r.mealType : classifyMeal(r.carbs, r.protein, r.fat, r.fiber);
          await saveMeal({
            inputText: r.inputText,
            parsedJson: [],
            glucoseBefore: r.glucoseBefore,
            glucoseAfter: r.glucoseAfter,
            carbsGrams: r.carbs,
            proteinGrams: r.protein,
            fatGrams: r.fat,
            fiberGrams: r.fiber,
            calories: cals,
            insulinUnits: r.insulin,
            mealType: mt,
            evaluation: null,
            createdAt: r.createdAt,
          });
          inserted++;
        } catch (e) {
          errs.push(t("row_error_prefix", { name: r.inputText, message: e instanceof Error ? e.message : t("row_failed") }));
        }
      }
      setSheetsResult({ read: sheetRows.length, inserted, errors: errs });
      logDebug("SHEETS_IMPORT", { read: sheetRows.length, inserted, failed: errs.length });
    } catch (e) {
      setSheetsResult({ error: e instanceof Error ? e.message : t("row_failed") });
    } finally {
      setSheetsRunning(false);
    }
  }

  function handleParse() {
    const result = parseCSV(csv);
    setRows(result);
    setParsed(true);
    setDone(false);
    setErrors([]);
    setImported(0);
  }

  async function handleImport() {
    setImporting(true);
    setErrors([]);
    let count = 0;
    const errs: string[] = [];
    for (const row of rows) {
      try {
        const carbs   = parseFloat(row.carbs)   || 0;
        const insulin = parseFloat(row.insulin) || null;
        const glucose = parseInt(row.glucose)   || null;
        const protein = parseFloat(row.protein) || 0;
        const fat     = parseFloat(row.fat)     || 0;
        const fiber   = parseFloat(row.fiber)   || 0;
        const calories = row.calories
          ? parseFloat(row.calories)
          : computeCalories(carbs, protein, fat);
        // Task #15: CSV import — like the sheets path above — never
        // pre-sets `evaluation`. lifecycleFor is the single writer of
        // that column; pre-supplied outcomes silently bypass the
        // window-validity guard and the unified resolver.
        const createdAt = toISO(row.date);
        await saveMeal({
          inputText: row.meal || t("default_meal_text"),
          parsedJson: [],
          glucoseBefore: glucose,
          glucoseAfter: null,
          carbsGrams: carbs,
          proteinGrams: protein,
          fatGrams: fat,
          fiberGrams: fiber,
          calories,
          insulinUnits: insulin,
          mealType: classifyMeal(carbs, protein, fat, fiber),
          evaluation: null,
          createdAt: createdAt ?? null,
        });
        count++;
      } catch (e) {
        errs.push(t("row_error_prefix", { name: row.meal || row.date || "?", message: e instanceof Error ? e.message : t("row_failed") }));
      }
    }
    setImported(count);
    setErrors(errs);
    setDone(true);
    setImporting(false);
    logDebug("IMPORT", { parsed: rows.length, inserted: count, failed: errs.length, error: errs[0] ?? null });
  }

  const inp: React.CSSProperties = { background:"var(--input-bg)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px", color:"var(--text)", fontSize:14, outline:"none", width:"100%" };
  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };

  const SAMPLE = `date,meal,glucose,carbs,protein,fat,fiber,calories,insulin,evaluation
2024-03-01,Oatmeal with banana,98,74,8,3,8,380,5.0,GOOD
2024-03-01,Turkey sandwich,112,53,25,9,4,390,3.5,GOOD
2024-03-02,Pancakes,105,92,12,10,2,510,4.0,LOW`;

  return (
    <div style={{ maxWidth:800, margin: embedded ? 0 : "0 auto" }}>
      {!embedded && (
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>{t("page_title")}</h1>
          <p style={{ color:"var(--text-faint)", fontSize:14 }}>{t("page_subtitle")}</p>
        </div>
      )}

      {/* GOOGLE SHEETS IMPORT */}
      <div style={{ ...card, marginBottom:20, borderColor:`${GREEN}25` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, gap:12, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:GREEN }}>{t("sheets_title")}</div>
            <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:2 }}>
              {t("sheets_subtitle")}
            </div>
          </div>
          <button
            onClick={handleSheetsImport}
            disabled={sheetsRunning}
            style={{
              padding:"10px 18px", borderRadius:10, border:"none",
              cursor: sheetsRunning ? "wait" : "pointer",
              background:`linear-gradient(135deg, ${GREEN}, #1BAD80)`, color:"var(--text)",
              fontSize:13, fontWeight:700, boxShadow:`0 4px 16px ${GREEN}40`,
              opacity: sheetsRunning ? 0.7 : 1,
            }}
          >
            {sheetsRunning ? t("sheets_btn_busy") : t("sheets_btn_idle")}
          </button>
        </div>
        {sheetsResult && (
          <div style={{ marginTop:10, fontSize:12, color: sheetsResult.error ? PINK : "var(--text-muted)" }}>
            {sheetsResult.error
              ? t("sheets_error", { message: sheetsResult.error })
              : (sheetsResult.errors && sheetsResult.errors.length
                  ? t("sheets_summary_with_errors", { read: sheetsResult.read ?? 0, inserted: sheetsResult.inserted ?? 0, errors: sheetsResult.errors.length })
                  : t("sheets_summary", { read: sheetsResult.read ?? 0, inserted: sheetsResult.inserted ?? 0 }))}
            {sheetsResult.errors && sheetsResult.errors.length > 0 && (
              <div style={{ marginTop:8, maxHeight:120, overflowY:"auto" }}>
                {sheetsResult.errors.slice(0,5).map((e, i) => (
                  <div key={i} style={{ fontSize:11, color:"var(--text-faint)", marginBottom:2 }}>• {e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ ...card, marginBottom:20, borderColor:`${ACCENT}25` }}>
        <div style={{ fontSize:13, fontWeight:600, color:ACCENT, marginBottom:10 }}>{t("expected_format_title")}</div>
        <pre style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)", background:"var(--surface-soft)", padding:"12px 14px", borderRadius:8, overflowX:"auto", lineHeight:1.6, margin:0 }}>{SAMPLE}</pre>
        <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:10, lineHeight:1.6 }}>
          {t("expected_format_help")}
        </div>
      </div>

      <div style={{ ...card, marginBottom:20 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>{t("paste_csv_title")}</div>
        <textarea
          style={{ ...inp, height:200, resize:"vertical", fontFamily:"var(--font-mono)", fontSize:12, fontFeatureSettings:'"tnum"' }}
          placeholder={SAMPLE}
          value={csv}
          onChange={e => { setCSV(e.target.value); setParsed(false); setDone(false); }}
        />
        <div style={{ marginTop:12, display:"flex", gap:10 }}>
          <button onClick={handleParse} disabled={!csv.trim()} style={{
            padding:"10px 20px", borderRadius:10, border:`1px solid ${csv.trim()?ACCENT+"40":BORDER}`, cursor:csv.trim()?"pointer":"not-allowed",
            background:csv.trim()?`${ACCENT}22`:"var(--surface-soft)", color:csv.trim()?ACCENT:"var(--text-ghost)",
            fontSize:13, fontWeight:600,
          }}>
            {t("preview_btn")}
          </button>
          <button onClick={() => setCSV(SAMPLE)} style={{ padding:"10px 16px", borderRadius:10, border:`1px solid ${BORDER}`, background:"transparent", color:"var(--text-faint)", fontSize:13, cursor:"pointer" }}>
            {t("load_sample_btn")}
          </button>
        </div>
      </div>

      {parsed && rows.length > 0 && (
        <div style={{ ...card, marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>{t("preview_count", { n: rows.length })}</div>
              <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:2 }}>{t("preview_dates_note")}</div>
            </div>
            {!done && (
              <button onClick={handleImport} disabled={importing} style={{
                padding:"10px 22px", borderRadius:10, border:"none", cursor:"pointer",
                background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"var(--text)",
                fontSize:13, fontWeight:700, boxShadow:`0 4px 16px ${ACCENT}40`,
              }}>
                {importing ? t("import_btn_busy", { imported, total: rows.length }) : t("import_btn_idle", { n: rows.length })}
              </button>
            )}
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ fontSize:10, color:"var(--text-faint)", letterSpacing:"0.07em", textTransform:"uppercase" }}>
                  {[t("header_date"),t("header_meal"),t("header_glucose"),t("header_carbs"),t("header_protein"),t("header_fat"),t("header_fiber"),t("header_calories"),t("header_insulin"),t("header_evaluation")].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", borderBottom:`1px solid ${BORDER}`, fontWeight:400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0,10).map((r,i) => (
                  <tr key={i} style={{ fontSize:12, borderBottom:`1px solid var(--surface-soft)` }}>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.date||"—"}</td>
                    <td style={{ padding:"9px 10px" }}>{r.meal.length>28?r.meal.slice(0,28)+"…":r.meal||"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.glucose||"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.carbs?`${r.carbs}g`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.protein?`${r.protein}g`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.fat?`${r.fat}g`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.fiber?`${r.fiber}g`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.calories?`${r.calories}`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"var(--text-dim)" }}>{r.insulin?`${r.insulin}u`:"—"}</td>
                    <td style={{ padding:"9px 10px" }}>{r.evaluation||t("auto_value")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && <div style={{ fontSize:11, color:"var(--text-ghost)", padding:"8px 10px" }}>{t("more_rows_suffix", { n: rows.length-10 })}</div>}
          </div>
        </div>
      )}

      {parsed && rows.length === 0 && (
        <div style={{ ...card, textAlign:"center", color:ORANGE, fontSize:14 }}>
          {t("no_rows_detected")}
        </div>
      )}

      {done && (
        <div style={{ padding:"20px 24px", borderRadius:14, background:`${GREEN}10`, border:`1px solid ${GREEN}30` }}>
          <div style={{ fontSize:16, fontWeight:700, color:GREEN, marginBottom:4 }}>
            {t("imported_summary", { imported, total: rows.length })}
          </div>
          {errors.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12, color:PINK, marginBottom:6 }}>{t("errors_count", { n: errors.length })}</div>
              {errors.map((e,i) => <div key={i} style={{ fontSize:11, color:"var(--text-dim)", marginBottom:2 }}>• {e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
