# Prompt für Replit AI — Google Sheet → Supabase Import

Copy everything between `=== BEGIN PROMPT ===` and `=== END PROMPT ===` and paste into Replit AI.

Dieser Prompt erledigt drei Dinge:
1. Fügt die fehlenden Spalten in der Supabase-Tabelle `meals` hinzu (`glucose_after`, `protein_grams`, `fat_grams`, `fiber_grams`, `calories`, `meal_type`).
2. Erweitert `lib/sheets.ts` um eine `readAllFromSheet()`-Funktion, die über den bestehenden Replit-Google-Connector liest.
3. Legt einen neuen "Import from Google Sheets"-Button auf `/import` an, der die Zeilen mappt und via `saveMeal()` in Supabase schreibt, inklusive historischer `created_at`.

---

=== BEGIN PROMPT ===

You are editing the Glev Next.js app (App Router, TypeScript, Supabase, Replit Connectors for Google Sheets, npm only).

## Goal

Import all historical meal rows from a Google Spreadsheet into the Supabase `meals` table, preserving original dates. If the target Supabase columns don't exist, add them via a migration the user must run manually. Add a new button in the existing `/import` page to trigger this import.

Spreadsheet ID: `174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY`
Spreadsheet URL: `https://docs.google.com/spreadsheets/d/174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY/edit?usp=sharing`

The user will share the sheet with the Replit Google Sheets service account (or has already authorized the Replit `google-sheet` connector, which is how the existing `lib/sheets.ts` writes to a sheet via `ReplitConnectors`).

---

## Step 1 — Supabase migration

Current `meals` schema (confirmed by user's Supabase UI screenshot):

```
id              uuid (PK)
user_id         uuid (FK auth.users.id)
input_text      text
parsed_json     jsonb
created_at      timestamp
glucose_before  int4
carbs_grams     int4
insulin_units   numeric
evaluation      text
```

Add these missing columns (idempotent — safe to re-run):

```sql
ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS glucose_after  int4,
  ADD COLUMN IF NOT EXISTS protein_grams  numeric,
  ADD COLUMN IF NOT EXISTS fat_grams      numeric,
  ADD COLUMN IF NOT EXISTS fiber_grams    numeric,
  ADD COLUMN IF NOT EXISTS calories       int4,
  ADD COLUMN IF NOT EXISTS meal_type      text;
```

Write this SQL to a new file `supabase/migrations/20260423_add_meal_macros.sql` in the repo. Then **print the SQL back in the chat and instruct the user to run it in the Supabase SQL Editor** (Supabase Dashboard → SQL Editor → New query → paste → Run). Do not attempt to run it yourself.

After the migration is applied, the existing `saveMeal()` fallback (which retries without the macro columns if they are missing) will no longer be triggered and all macros will persist.

---

## Step 2 — Extend `lib/sheets.ts` with a read function

Open `lib/sheets.ts`. Keep the existing export functions (`syncEntryToSheets`, `syncAllLogsToSheets`) untouched. Add at the bottom:

```ts
// ---- READ FROM SHEET --------------------------------------------------------

export interface SheetRow {
  [columnName: string]: string;
}

/**
 * Reads all data rows from the configured sheet (or a provided spreadsheetId).
 * First row is treated as the header and is used as keys.
 * Range defaults to "A1:Z100000" which covers up to 26 columns and 100k rows.
 */
export async function readAllFromSheet(opts?: {
  spreadsheetId?: string;
  sheetName?: string; // e.g. "Sheet1" or "Log"
  range?: string;     // defaults to A1:Z100000
}): Promise<SheetRow[]> {
  const id = opts?.spreadsheetId ?? SHEET_ID;
  if (!id) throw new Error("No spreadsheet id provided and GOOGLE_SHEET_ID is not set");

  const range = opts?.range ?? "A1:Z100000";
  const sheetPrefix = opts?.sheetName ? `${encodeURIComponent(opts.sheetName)}!` : "";
  const path = `/v4/spreadsheets/${id}/values/${sheetPrefix}${encodeURIComponent(range)}`;

  const connectors = new ReplitConnectors();
  const res = await connectors.proxy("google-sheet", path, { method: "GET" } as any);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  const values = json.values ?? [];
  if (values.length < 2) return [];

  const headers = values[0].map(h => (h ?? "").toString().trim());
  return values.slice(1).map(row => {
    const obj: SheetRow = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? "").toString().trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v.length > 0));
}
```

If `ReplitConnectors.proxy()` does not accept `"GET"` in this codebase (check the existing `proxy()` helper — it may only handle POST/PUT/DELETE), then copy the existing `proxy()` helper signature and inline the GET call above with the same pattern used by the writers in the file.

---

## Step 3 — New API route `/api/import/sheets`

Create `app/api/import/sheets/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readAllFromSheet, type SheetRow } from "@/lib/sheets";
import { saveMeal, classifyMeal, computeEvaluation, computeCalories } from "@/lib/meals";
import { logDebug } from "@/lib/debug";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY";

// Normalize a header cell to lowercase alphanumeric for mapping
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(row: SheetRow, keys: string[]): string {
  // Find the first header whose normalized form matches any of the candidates.
  for (const k of keys) {
    const nk = norm(k);
    const match = Object.keys(row).find(h => norm(h) === nk);
    if (match) return row[match] ?? "";
  }
  return "";
}

function toNumber(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
function toNumOrNull(v: string): number | null {
  const n = toNumber(v);
  return n === 0 && !v.trim().startsWith("0") ? null : n;
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sheetName = typeof body.sheetName === "string" ? body.sheetName : undefined;

    const rows = await readAllFromSheet({ spreadsheetId: SPREADSHEET_ID, sheetName });
    let inserted = 0;
    const errors: string[] = [];

    for (const r of rows) {
      try {
        const dateStr = pick(r, ["date", "datetime", "timestamp", "day", "when"]);
        const meal    = pick(r, ["meal", "food", "description", "item", "notes"]);
        const carbs   = toNumber(pick(r, ["carbs", "carbohydrates", "carbgrams", "netcarbs"]));
        const protein = toNumber(pick(r, ["protein", "proteins", "proteingrams"]));
        const fat     = toNumber(pick(r, ["fat", "fats", "fatgrams"]));
        const fiber   = toNumber(pick(r, ["fiber", "fibre", "fibergrams"]));
        const cals    = (() => {
          const c = pick(r, ["calories", "kcal", "cals", "energy"]);
          return c ? Math.round(toNumber(c)) : computeCalories(carbs, protein, fat);
        })();
        const glucoseBefore = toNumOrNull(pick(r, ["glucosebefore", "bgbefore", "glucose", "bg", "sugar"]));
        const glucoseAfter  = toNumOrNull(pick(r, ["glucoseafter", "bgafter", "postglucose"]));
        const insulin       = toNumOrNull(pick(r, ["insulin", "dose", "bolus", "bolusunits", "units"]));
        const evalRaw       = pick(r, ["evaluation", "eval", "result", "outcome", "dosequality"]).toUpperCase();
        const ev = ["GOOD","LOW","HIGH","SPIKE","OVERDOSE","UNDERDOSE"].includes(evalRaw)
          ? evalRaw
          : (insulin ? computeEvaluation(carbs, insulin, glucoseBefore) : "GOOD");
        const mealType = pick(r, ["mealtype", "type", "category"]) || classifyMeal(carbs, protein, fat);

        await saveMeal({
          inputText: meal || "Imported from Google Sheets",
          parsedJson: [],
          glucoseBefore,
          glucoseAfter,
          carbsGrams: carbs,
          proteinGrams: protein,
          fatGrams: fat,
          fiberGrams: fiber,
          calories: cals,
          insulinUnits: insulin,
          mealType,
          evaluation: ev,
          createdAt: toISO(dateStr) ?? null,
        });
        inserted++;
      } catch (e) {
        errors.push(`Row "${r[Object.keys(r)[0]] ?? "?"}": ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    logDebug("SHEETS_IMPORT", { read: rows.length, inserted, failed: errors.length });
    return NextResponse.json({ read: rows.length, inserted, errors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sheets import failed";
    logDebug("SHEETS_IMPORT_ERROR", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

Note: `saveMeal()` already runs on the server with the user's Supabase session. If the API route runs outside of the authenticated user context, this will fail with "Not authenticated". In that case, wrap it in a server action called from a client button, or forward the Supabase session cookie into the route (the existing patterns in `/api/parse-food/route.ts` and `/api/log/route.ts` already handle this — follow whichever pattern is used there).

---

## Step 4 — Add a "Import from Google Sheets" button to `/import`

In `app/(protected)/import/page.tsx`, add a new card at the **top** of the page body (above the "Expected CSV Format" card). This card sits alongside the existing CSV flow — it does not remove it.

```tsx
{/* GOOGLE SHEETS IMPORT */}
<div style={{ ...card, marginBottom:20, borderColor: `${GREEN}25` }}>
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
    <div>
      <div style={{ fontSize:13, fontWeight:600, color:GREEN }}>Import from Google Sheets</div>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>
        Pull your historical log from the configured Google Spreadsheet.
      </div>
    </div>
    <button
      onClick={async () => {
        setSheetsRunning(true);
        setSheetsResult(null);
        try {
          const res = await fetch("/api/import/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
          const data = await res.json();
          setSheetsResult(data);
        } catch (e) {
          setSheetsResult({ error: e instanceof Error ? e.message : "Failed" });
        } finally { setSheetsRunning(false); }
      }}
      disabled={sheetsRunning}
      style={{
        padding:"10px 18px", borderRadius:10, border:"none", cursor: sheetsRunning ? "wait" : "pointer",
        background: `linear-gradient(135deg, ${GREEN}, #1BAD80)`, color:"#fff",
        fontSize:13, fontWeight:700, boxShadow:`0 4px 16px ${GREEN}40`,
      }}
    >
      {sheetsRunning ? "Importing from Sheets…" : "Import from Sheets"}
    </button>
  </div>
  {sheetsResult && (
    <div style={{ marginTop:10, fontSize:12, color: sheetsResult.error ? PINK : "rgba(255,255,255,0.55)" }}>
      {sheetsResult.error
        ? `Error: ${sheetsResult.error}`
        : `Read ${sheetsResult.read} rows · Inserted ${sheetsResult.inserted}${sheetsResult.errors?.length ? ` · ${sheetsResult.errors.length} errors` : ""}`}
    </div>
  )}
</div>
```

Add the corresponding state at the top of the component (with the other `useState` calls):

```tsx
const [sheetsRunning, setSheetsRunning] = useState(false);
const [sheetsResult, setSheetsResult]   = useState<{ read?: number; inserted?: number; errors?: string[]; error?: string } | null>(null);
```

---

## Step 5 — Connector setup (user action)

Tell the user:

> The Replit `google-sheet` connector must be authorized in this repl (if it isn't already — the existing `lib/sheets.ts` uses it to push data, so the token may already exist). If not, open the Replit "Tools → Connectors" panel, pick Google Sheets, and authenticate. The connected Google account must have access to the sheet `174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY`. If the sheet is owned by another Google account, share it with `viewer` permission to the Google account that is connected in Replit.
>
> Then run the SQL migration from `supabase/migrations/20260423_add_meal_macros.sql` in the Supabase Dashboard → SQL Editor.
>
> Finally, go to `/import` in the app and click **Import from Sheets**.

---

## Step 6 — Verify

1. Run `npm install && npm run dev`.
2. In the Supabase SQL editor, run the migration SQL. Confirm the new columns appear on the `meals` table.
3. Visit `/import`, click "Import from Sheets".
4. Check `GET /api/debug/state` — inserted rows should appear with their historical `created_at` timestamps.
5. Visit `/entries` — historical meals from the sheet should be listed with all macros populated.
6. Visit `/insights` — Total Meals should now include historical meals.

Report back: (a) which columns were added, (b) how many rows were read vs inserted, (c) any rows that failed with their error text, and (d) whether `/entries` shows the imported data sorted by original date (newest first).

Hard requirements:
- Do NOT switch package managers. Use `npm` only.
- Do NOT remove the existing CSV import UI — add the Sheets button alongside it.
- Do NOT hardcode user credentials. Rely on the already-configured Replit `google-sheet` connector.
- Do NOT run the Supabase migration from code. Print the SQL and let the user run it manually.
- Preserve `created_at` from the sheet — never stamp `now()` unless the date column is empty.

=== END PROMPT ===

---

## Zusätzliche Hinweise für dich

**Zu den fehlenden Supabase-Spalten:** Der aktuelle Code in `lib/meals.ts` hat einen Fallback: wenn Supabase bei einem INSERT meckert, dass Spalten fehlen (`protein_grams`, `fat_grams`, `fiber_grams`, `calories`), versucht er es nochmal ohne diese Spalten. Das heißt, der Import funktioniert technisch auch OHNE die Migration — aber dann gehen die Makros verloren und Insights zeigt keine Protein/Fett/Ballaststoff-Werte. Also: Migration ausführen ist der richtige Weg.

**Zum Google-Sheet-Connector:** In `lib/sheets.ts` wird bereits `ReplitConnectors` mit der `google-sheet`-Connection benutzt. Wenn du in Replit schon Daten aus der App in ein Sheet geschrieben hast, ist der Connector vermutlich schon authorisiert. Falls nicht: Replit → Tools → Connectors → Google Sheets → Connect.

**Sheet-Freigabe:** Dein Sheet liegt auf `174KpxhA85hGCWCvQ40CeBitFBQrINW1OKss49nBmpFY`. Stell sicher, dass das mit dem Replit verbundene Google-Konto Leserechte darauf hat. Falls das Sheet einem anderen Konto gehört, im Sheet oben rechts auf "Share" → dem Replit-Google-Account Leserechte geben.

**Ablauf**, den ich empfehle:
1. Aktuellen Replit-Stand auf GitHub pushen (wie vorher besprochen).
2. `REPLIT_PROMPT.md` in Replit AI pasten → Basis-Fixes anwenden lassen → testen.
3. Dann `REPLIT_PROMPT_SHEETS_IMPORT.md` pasten → Sheet-Import hinzufügen lassen.
4. Supabase-Migration manuell im SQL Editor laufen lassen.
5. In `/import` auf "Import from Sheets" klicken.
6. In `/entries` prüfen, ob deine historischen Daten da sind.
