import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, entriesTable } from "@workspace/db";
import {
  GetEntriesQueryParams,
  GetEntriesResponse,
  CreateEntryBody,
  GetEntryParams,
  GetEntryResponse,
  DeleteEntryParams,
  ImportBatchBody,
} from "@workspace/api-zod";
import { calculateMetrics } from "../lib/calculation";

const router: IRouter = Router();

router.get("/entries", async (req, res): Promise<void> => {
  const query = GetEntriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset, mealType } = query.data;

  let dbQuery = db.select().from(entriesTable).$dynamic();

  if (mealType) {
    dbQuery = dbQuery.where(eq(entriesTable.mealType, mealType));
  }

  const entries = await dbQuery
    .orderBy(desc(entriesTable.timestamp))
    .limit(limit)
    .offset(offset);

  const countQuery = await db.select().from(entriesTable);
  const total = mealType
    ? countQuery.filter((e) => e.mealType === mealType).length
    : countQuery.length;

  res.json(GetEntriesResponse.parse({ entries, total }));
});

router.post("/entries", async (req, res): Promise<void> => {
  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { delta, speed, evaluation } = calculateMetrics(
    parsed.data.glucoseBefore,
    parsed.data.glucoseAfter,
    parsed.data.timeDifferenceMinutes,
    parsed.data.insulinUnits,
    parsed.data.carbsGrams,
  );

  const insertData = {
    timestamp: parsed.data.timestamp ? new Date(parsed.data.timestamp) : new Date(),
    glucoseBefore: parsed.data.glucoseBefore,
    glucoseAfter: parsed.data.glucoseAfter ?? null,
    carbsGrams: parsed.data.carbsGrams,
    insulinUnits: parsed.data.insulinUnits,
    mealType: parsed.data.mealType,
    mealDescription: parsed.data.mealDescription ?? null,
    timeDifferenceMinutes: parsed.data.timeDifferenceMinutes ?? null,
    notes: parsed.data.notes ?? null,
    delta,
    speed,
    evaluation,
  };

  const [entry] = await db.insert(entriesTable).values(insertData).returning();
  res.status(201).json(GetEntryResponse.parse(entry));
});

router.post("/entries/batch", async (req, res): Promise<void> => {
  const parsed = ImportBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const entriesData = parsed.data.entries.map((e) => {
    const { delta, speed, evaluation } = calculateMetrics(
      e.glucoseBefore,
      e.glucoseAfter,
      e.timeDifferenceMinutes,
      e.insulinUnits,
      e.carbsGrams,
    );

    return {
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      glucoseBefore: e.glucoseBefore,
      glucoseAfter: e.glucoseAfter ?? null,
      carbsGrams: e.carbsGrams,
      insulinUnits: e.insulinUnits,
      mealType: e.mealType,
      mealDescription: e.mealDescription ?? null,
      timeDifferenceMinutes: e.timeDifferenceMinutes ?? null,
      notes: e.notes ?? null,
      delta,
      speed,
      evaluation,
    };
  });

  const entries = await db.insert(entriesTable).values(entriesData).returning();

  res.status(201).json({ imported: entries.length, entries });
});

router.get("/entries/:id", async (req, res): Promise<void> => {
  const params = GetEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .select()
    .from(entriesTable)
    .where(eq(entriesTable.id, params.data.id));

  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  res.json(GetEntryResponse.parse(entry));
});

router.delete("/entries/:id", async (req, res): Promise<void> => {
  const params = DeleteEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .delete(entriesTable)
    .where(eq(entriesTable.id, params.data.id))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
