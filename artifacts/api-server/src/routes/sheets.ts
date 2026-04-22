import { Router, type IRouter } from "express";
import { db, entriesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { syncAllLogsToSheets } from "../lib/sheets";

const router: IRouter = Router();

router.post("/sheets/sync", async (req, res): Promise<void> => {
  try {
    const entries = await db
      .select()
      .from(entriesTable)
      .orderBy(asc(entriesTable.timestamp));

    await syncAllLogsToSheets(entries as Record<string, unknown>[]);
    res.json({ ok: true, count: entries.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
