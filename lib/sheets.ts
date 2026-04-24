"use server";

import { google, sheets_v4 } from "googleapis";
import type { LogEntry } from "./db";

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? "";

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

let cachedClient: sheets_v4.Sheets | null = null;

function getServiceAccountCreds() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  if (!email || !rawKey) {
    throw new Error(
      "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (and GOOGLE_SHEET_ID).",
    );
  }
  // Vercel/.env stores newlines as literal "\n"; restore them for the JWT signer.
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return { email, privateKey };
}

function sheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;
  const { email, privateKey } = getServiceAccountCreds();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  cachedClient = google.sheets({ version: "v4", auth });
  return cachedClient;
}

export async function syncEntryToSheets(entry: LogEntry): Promise<void> {
  if (!SHEET_ID) return;
  const sheets = sheetsClient();
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
  const sheets = sheetsClient();

  // Write header row.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS] },
  });

  // Clear old data rows.
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
  const a1 = opts?.sheetName ? `${opts.sheetName}!${range}` : range;
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: a1 });
  const values = res.data.values ?? [];
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
