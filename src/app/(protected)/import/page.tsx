"use client";

import { useState } from "react";
import { saveMeal, classifyMeal, computeEvaluation } from "@/lib/meals";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

interface ParsedRow { date: string; meal: string; glucose: string; carbs: string; insulin: string; evaluation: string; }

function parseRange(val: string): string {
  const cleaned = val.replace(/[a-zA-Z]/g, "").trim();
  const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const avg = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
    return Math.round(avg).toString();
  }
  return cleaned;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ""));
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h.includes("date")||h.includes("time")) colMap.date  = i;
    if (h.includes("meal")||h.includes("food")||h.includes("desc")) colMap.meal  = i;
    if (h.includes("glucose")||h.includes("bg")||h.includes("sugar")) colMap.glucose = i;
    if (h.includes("carb")) colMap.carbs = i;
    if (h.includes("insulin")||h.includes("dose")) colMap.insulin = i;
    if (h.includes("eval")||h.includes("result")) colMap.evaluation = i;
  });
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim().replace(/^["']|["']$/g,""));
    return {
      date:       cells[colMap.date  ?? 0] ?? "",
      meal:       cells[colMap.meal  ?? 1] ?? "",
      glucose:    parseRange(cells[colMap.glucose ?? 2] ?? ""),
      carbs:      parseRange(cells[colMap.carbs  ?? 3] ?? ""),
      insulin:    parseRange(cells[colMap.insulin ?? 4] ?? ""),
      evaluation: cells[colMap.evaluation ?? 5] ?? "",
    };
  }).filter(r => r.meal || r.carbs);
}

export default function ImportPage() {
  const [csv, setCSV]         = useState("");
  const [rows, setRows]       = useState<ParsedRow[]>([]);
  const [parsed, setParsed]   = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported]   = useState(0);
  const [errors, setErrors]   = useState<string[]>([]);
  const [done, setDone]       = useState(false);

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
        const carbs   = parseInt(row.carbs)   || 0;
        const insulin = parseFloat(row.insulin) || null;
        const glucose = parseInt(row.glucose) || null;
        const ev = row.evaluation
          ? (["GOOD","LOW","HIGH","SPIKE","OVERDOSE","UNDERDOSE"].includes(row.evaluation.toUpperCase()) ? row.evaluation.toUpperCase() : computeEvaluation(carbs, insulin||0, glucose))
          : (insulin ? computeEvaluation(carbs, insulin, glucose) : "GOOD");
        await saveMeal({
          inputText: row.meal || "Imported meal",
          parsedJson: [],
          glucoseBefore: glucose,
          glucoseAfter: null,
          carbsGrams: carbs,
          insulinUnits: insulin,
          mealType: classifyMeal(carbs, 0, 0),
          evaluation: ev,
        });
        count++;
      } catch (e) {
        errs.push(`Row "${row.meal}": ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setImported(count);
    setErrors(errs);
    setDone(true);
    setImporting(false);
  }

  const inp: React.CSSProperties = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:14, outline:"none", width:"100%" };
  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };

  const SAMPLE = `date,meal,glucose_before,carbs,insulin,evaluation
2024-03-01,Oatmeal with banana,98,74,5.0,GOOD
2024-03-01,Turkey sandwich,112,53,3.5,GOOD
2024-03-02,Pancakes,105,92,4.0,LOW`;

  return (
    <div style={{ maxWidth:800, margin:"0 auto" }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Import Center</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>Import historical meal data from CSV. Maps common column names automatically.</p>
      </div>

      {/* INSTRUCTIONS */}
      <div style={{ ...card, marginBottom:20, borderColor:`${ACCENT}25` }}>
        <div style={{ fontSize:13, fontWeight:600, color:ACCENT, marginBottom:10 }}>Expected CSV Format</div>
        <pre style={{ fontFamily:"monospace", fontSize:11, color:"rgba(255,255,255,0.5)", background:"rgba(0,0,0,0.3)", padding:"12px 14px", borderRadius:8, overflowX:"auto", lineHeight:1.6, margin:0 }}>{SAMPLE}</pre>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:10, lineHeight:1.6 }}>
          Column names are detected automatically. Supported: <code style={{color:"rgba(255,255,255,0.5)"}}>date</code>, <code style={{color:"rgba(255,255,255,0.5)"}}>meal/food/description</code>, <code style={{color:"rgba(255,255,255,0.5)"}}>glucose/bg</code>, <code style={{color:"rgba(255,255,255,0.5)"}}>carbs</code>, <code style={{color:"rgba(255,255,255,0.5)"}}>insulin/dose</code>, <code style={{color:"rgba(255,255,255,0.5)"}}>evaluation/result</code>
        </div>
      </div>

      {/* CSV INPUT */}
      <div style={{ ...card, marginBottom:20 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Paste CSV Data</div>
        <textarea
          style={{ ...inp, height:200, resize:"vertical", fontFamily:"monospace", fontSize:12, fontFeatureSettings:'"tnum"' }}
          placeholder={SAMPLE}
          value={csv}
          onChange={e => { setCSV(e.target.value); setParsed(false); setDone(false); }}
        />
        <div style={{ marginTop:12, display:"flex", gap:10 }}>
          <button onClick={handleParse} disabled={!csv.trim()} style={{
            padding:"10px 20px", borderRadius:10, border:`1px solid ${csv.trim()?ACCENT+"40":BORDER}`, cursor:csv.trim()?"pointer":"not-allowed",
            background:csv.trim()?`${ACCENT}22`:"rgba(255,255,255,0.03)", color:csv.trim()?ACCENT:"rgba(255,255,255,0.2)",
            fontSize:13, fontWeight:600,
          }}>
            Preview Import
          </button>
          <button onClick={() => setCSV(SAMPLE)} style={{ padding:"10px 16px", borderRadius:10, border:`1px solid ${BORDER}`, background:"transparent", color:"rgba(255,255,255,0.3)", fontSize:13, cursor:"pointer" }}>
            Load Sample
          </button>
        </div>
      </div>

      {/* PREVIEW TABLE */}
      {parsed && rows.length > 0 && (
        <div style={{ ...card, marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>Preview — {rows.length} rows detected</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:2 }}>Review before importing</div>
            </div>
            {!done && (
              <button onClick={handleImport} disabled={importing} style={{
                padding:"10px 22px", borderRadius:10, border:"none", cursor:"pointer",
                background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff",
                fontSize:13, fontWeight:700, boxShadow:`0 4px 16px ${ACCENT}40`,
              }}>
                {importing ? `Importing… ${imported}/${rows.length}` : `Import ${rows.length} Rows`}
              </button>
            )}
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ fontSize:10, color:"rgba(255,255,255,0.3)", letterSpacing:"0.07em", textTransform:"uppercase" }}>
                  {["Date","Meal","Glucose","Carbs","Insulin","Eval"].map(h => (
                    <th key={h} style={{ padding:"8px 10px", textAlign:"left", borderBottom:`1px solid ${BORDER}`, fontWeight:400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0,10).map((r,i) => (
                  <tr key={i} style={{ fontSize:12, borderBottom:`1px solid rgba(255,255,255,0.03)` }}>
                    <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.4)" }}>{r.date||"—"}</td>
                    <td style={{ padding:"9px 10px" }}>{r.meal.length>35?r.meal.slice(0,35)+"…":r.meal||"—"}</td>
                    <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.5)" }}>{r.glucose||"—"}</td>
                    <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.5)" }}>{r.carbs?`${r.carbs}g`:"—"}</td>
                    <td style={{ padding:"9px 10px", color:"rgba(255,255,255,0.5)" }}>{r.insulin?`${r.insulin}u`:"—"}</td>
                    <td style={{ padding:"9px 10px" }}>{r.evaluation||"auto"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 10 && <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", padding:"8px 10px" }}>… and {rows.length-10} more rows</div>}
          </div>
        </div>
      )}

      {parsed && rows.length === 0 && (
        <div style={{ ...card, textAlign:"center", color:ORANGE, fontSize:14 }}>
          Could not detect any valid rows. Check your CSV format matches the expected structure above.
        </div>
      )}

      {/* RESULT */}
      {done && (
        <div style={{ padding:"20px 24px", borderRadius:14, background:`${GREEN}10`, border:`1px solid ${GREEN}30` }}>
          <div style={{ fontSize:16, fontWeight:700, color:GREEN, marginBottom:4 }}>
            ✓ Imported {imported} of {rows.length} rows
          </div>
          {errors.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12, color:PINK, marginBottom:6 }}>{errors.length} errors:</div>
              {errors.map((e,i) => <div key={i} style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginBottom:2 }}>• {e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
