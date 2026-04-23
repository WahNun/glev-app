"use server";

import { ReplitConnectors } from "@replit/connectors-sdk";
import type { LogEntry } from "./db";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";

const HEADERS = [
  "Date", "Meal", "Glucose Before", "Glucose After",
  "Carbs", "Fiber", "Protein", "Fat", "Net Carbs",
  "Bolus Units", "Meal Type", "Evaluation", "Notes",
];

function entryToRow(e: LogEntry): string[] {
  return [
    e.date ?? "",
    e.meal ?? "",
    String(e.glucose_before ?? ""),
    String(e.glucose_after ?? ""),
    String(e.carbs ?? ""),
    String(e.fiber ?? ""),
    String(e.protein ?? ""),
    String(e.fat ?? ""),
    String(e.net_carbs ?? ""),
    String(e.bolus_units ?? ""),
    e.meal_type ?? "",
    e.evaluation ?? "",
    e.notes ?? "",
  ];
}

async function proxy(path: string, options: RequestInit): Promise<void> {
  const connectors = new ReplitConnectors();
  const res = await connectors.proxy("google-sheet", path, options as any);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
}

async function proxyJson<T>(path: string, options: RequestInit): Promise<T> {
  const connectors = new ReplitConnectors();
  const res = await connectors.proxy("google-sheet", path, options as any);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sheets API ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function syncEntryToSheets(entry: LogEntry): Promise<void> {
  if (!SHEET_ID) return;
  await proxy(
    `/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [entryToRow(entry)] }) },
  );
}

export async function syncAllLogsToSheets(entries: LogEntry[]): Promise<{ count: number }> {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is not configured");

  await proxy(
    `/v4/spreadsheets/${SHEET_ID}/values/A1?valueInputOption=USER_ENTERED`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [HEADERS] }) },
  );

  await proxy(
    `/v4/spreadsheets/${SHEET_ID}/values:batchClear`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ranges: ["A2:M10000"] }) },
  );

  if (entries.length > 0) {
    await proxy(
      `/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: [{ range: "A2", values: entries.map(entryToRow) }],
        }),
      },
    );
  }
  return { count: entries.length };
}

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
  sheetName?: string;
  range?: string;
}): Promise<SheetRow[]> {
  const id = opts?.spreadsheetId ?? SHEET_ID;
  if (!id) throw new Error("No spreadsheet id provided and GOOGLE_SHEET_ID is not set");

  const range = opts?.range ?? "A1:Z100000";
  const a1 = opts?.sheetName ? `${encodeURIComponent(opts.sheetName)}!${encodeURIComponent(range)}` : encodeURIComponent(range);
  const path = `/v4/spreadsheets/${id}/values/${a1}`;

  const json = await proxyJson<{ values?: string[][] }>(path, { method: "GET" });
  const values = json.values ?? [];
  if (values.length < 2) return [];

  const headers = values[0].map((h) => (h ?? "").toString().trim());
  return values
    .slice(1)
    .map((row) => {
      const obj: SheetRow = {};
      headers.forEach((h, i) => {
        obj[h] = (row[i] ?? "").toString().trim();
      });
      return obj;
    })
    .filter((r) => Object.values(r).some((v) => v.length > 0));
}
