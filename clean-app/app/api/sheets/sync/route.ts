import { NextResponse } from "next/server";
import { syncAllLogsToSheets } from "../../../../lib/sheets";
import { fetchAllLogs } from "../../../../lib/db";

export async function POST() {
  try {
    const logs = await fetchAllLogs();
    const result = await syncAllLogsToSheets(logs);
    return NextResponse.json({ ok: true, count: result.count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
