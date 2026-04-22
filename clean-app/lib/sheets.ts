"use server";

import { google } from "googleapis";
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

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account credentials not configured");
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function syncEntryToSheets(entry: LogEntry): Promise<void> {
  if (!SHEET_ID) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [entryToRow(entry)] },
  });
}

export async function syncAllLogsToSheets(entries: LogEntry[]): Promise<{ count: number }> {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is not configured");
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS] },
  });

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: SHEET_ID,
    requestBody: { ranges: ["A2:M10000"] },
  });

  if (entries.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [{ range: "A2", values: entries.map(entryToRow) }],
      },
    });
  }

  return { count: entries.length };
}
