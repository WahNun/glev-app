import { ReplitConnectors } from "@replit/connectors-sdk";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";

const HEADERS = [
  "Date", "Meal", "Glucose Before", "Glucose After",
  "Carbs", "Fiber", "Protein", "Fat", "Net Carbs",
  "Bolus Units", "Meal Type", "Evaluation", "Notes",
];

function entryToRow(e: Record<string, unknown>): string[] {
  const ts = typeof e.timestamp === "string" ? e.timestamp : "";
  return [
    String(e.date ?? ts.split("T")[0] ?? ""),
    String(e.meal ?? e.mealDescription ?? ""),
    String(e.glucoseBefore ?? e.glucose_before ?? ""),
    String(e.glucoseAfter ?? e.glucose_after ?? ""),
    String(e.carbsGrams ?? e.carbs ?? ""),
    String(e.fiberGrams ?? e.fiber ?? ""),
    String(e.protein ?? ""),
    String(e.fat ?? ""),
    String(e.netCarbs ?? e.net_carbs ?? ""),
    String(e.insulinUnits ?? e.bolusUnits ?? e.bolus_units ?? ""),
    String(e.mealType ?? e.meal_type ?? ""),
    String(e.evaluation ?? ""),
    String(e.notes ?? ""),
  ];
}

async function makeRequest(path: string, options: RequestInit): Promise<void> {
  const connectors = new ReplitConnectors();
  const res = await connectors.proxy("google-sheet", path, options as any);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API error ${res.status}: ${body}`);
  }
}

export async function ensureSheetHeader(): Promise<void> {
  if (!SHEET_ID) return;
  const connectors = new ReplitConnectors();
  const res = await connectors.proxy(
    "google-sheet",
    `/v4/spreadsheets/${SHEET_ID}/values/A1:M1`,
    { method: "GET" } as any,
  );
  const data = await res.json() as { values?: string[][] };
  if ((data.values?.[0]?.length ?? 0) > 0) return;
  await makeRequest(
    `/v4/spreadsheets/${SHEET_ID}/values/A1?valueInputOption=USER_ENTERED`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [HEADERS] }) },
  );
}

export async function syncEntryToSheets(entry: Record<string, unknown>): Promise<void> {
  if (!SHEET_ID) return;
  await ensureSheetHeader();
  const row = entryToRow(entry);
  await makeRequest(
    `/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) },
  );
}

export async function syncAllLogsToSheets(entries: Record<string, unknown>[]): Promise<void> {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID environment variable is not configured");
  await ensureSheetHeader();
  await makeRequest(
    `/v4/spreadsheets/${SHEET_ID}/values:batchClear`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ranges: ["A2:M10000"] }) },
  );
  if (entries.length === 0) return;
  const rows = entries.map(entryToRow);
  await makeRequest(
    `/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [{ range: "A2", values: rows }],
      }),
    },
  );
}
