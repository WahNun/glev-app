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
