import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, entriesTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetMealPatternsResponse,
  GetGlucoseTrendQueryParams,
  GetGlucoseTrendResponse,
} from "@workspace/api-zod";
import {
  calculateControlScore,
  calculateHypoRate,
  calculateSpikeRate,
} from "../lib/calculation";

const router: IRouter = Router();

router.get("/insights/dashboard", async (req, res): Promise<void> => {
  const allEntries = await db
    .select()
    .from(entriesTable)
    .orderBy(desc(entriesTable.timestamp));

  const recentEntries = allEntries.slice(0, 10);

  const controlScore = calculateControlScore(allEntries.map((e) => e.evaluation));
  const hypoRate = calculateHypoRate(allEntries.map((e) => e.glucoseAfter));
  const spikeRate = calculateSpikeRate(allEntries.map((e) => e.glucoseAfter));

  const withGlucoseBefore = allEntries.filter((e) => e.glucoseBefore != null);
  const withGlucoseAfter = allEntries.filter((e) => e.glucoseAfter != null);

  const avgGlucoseBefore =
    withGlucoseBefore.length > 0
      ? withGlucoseBefore.reduce((s, e) => s + e.glucoseBefore, 0) / withGlucoseBefore.length
      : null;

  const avgGlucoseAfter =
    withGlucoseAfter.length > 0
      ? withGlucoseAfter.reduce((s, e) => s + (e.glucoseAfter ?? 0), 0) / withGlucoseAfter.length
      : null;

  const avgCarbsGrams =
    allEntries.length > 0
      ? allEntries.reduce((s, e) => s + e.carbsGrams, 0) / allEntries.length
      : null;

  const avgInsulinUnits =
    allEntries.length > 0
      ? allEntries.reduce((s, e) => s + e.insulinUnits, 0) / allEntries.length
      : null;

  const evaluationBreakdown = {
    GOOD: allEntries.filter((e) => e.evaluation === "GOOD").length,
    OVERDOSE: allEntries.filter((e) => e.evaluation === "OVERDOSE").length,
    UNDERDOSE: allEntries.filter((e) => e.evaluation === "UNDERDOSE").length,
    CHECK_CONTEXT: allEntries.filter((e) => e.evaluation === "CHECK_CONTEXT").length,
  };

  const goodRate =
    allEntries.length > 0
      ? evaluationBreakdown.GOOD / allEntries.length
      : 0;

  res.json(
    GetDashboardStatsResponse.parse({
      controlScore,
      hypoRate,
      spikeRate,
      totalEntries: allEntries.length,
      goodRate,
      avgGlucoseBefore,
      avgGlucoseAfter,
      avgCarbsGrams,
      avgInsulinUnits,
      recentEntries,
      evaluationBreakdown,
    }),
  );
});

router.get("/insights/patterns", async (req, res): Promise<void> => {
  const allEntries = await db.select().from(entriesTable);

  const mealTypes = ["FAST_CARBS", "HIGH_FAT", "HIGH_PROTEIN", "BALANCED"] as const;

  const patterns = mealTypes.map((mealType) => {
    const typeEntries = allEntries.filter((e) => e.mealType === mealType);

    if (typeEntries.length === 0) {
      return {
        mealType,
        count: 0,
        avgCarbsGrams: 0,
        avgInsulinUnits: 0,
        avgDelta: null,
        avgSpeed: null,
        goodRate: 0,
        insulinToCarb: 0,
      };
    }

    const avgCarbsGrams =
      typeEntries.reduce((s, e) => s + e.carbsGrams, 0) / typeEntries.length;
    const avgInsulinUnits =
      typeEntries.reduce((s, e) => s + e.insulinUnits, 0) / typeEntries.length;

    const withDelta = typeEntries.filter((e) => e.delta != null);
    const avgDelta =
      withDelta.length > 0
        ? withDelta.reduce((s, e) => s + (e.delta ?? 0), 0) / withDelta.length
        : null;

    const withSpeed = typeEntries.filter((e) => e.speed != null);
    const avgSpeed =
      withSpeed.length > 0
        ? withSpeed.reduce((s, e) => s + (e.speed ?? 0), 0) / withSpeed.length
        : null;

    const goodCount = typeEntries.filter((e) => e.evaluation === "GOOD").length;
    const goodRate = goodCount / typeEntries.length;

    const insulinToCarb =
      avgCarbsGrams > 0 ? (avgInsulinUnits / avgCarbsGrams) * 10 : 0;

    return {
      mealType,
      count: typeEntries.length,
      avgCarbsGrams,
      avgInsulinUnits,
      avgDelta,
      avgSpeed,
      goodRate,
      insulinToCarb,
    };
  });

  res.json(GetMealPatternsResponse.parse({ patterns }));
});

router.get("/insights/glucose-trend", async (req, res): Promise<void> => {
  const query = GetGlucoseTrendQueryParams.safeParse(req.query);
  const days = query.success ? (query.data.days ?? 7) : 7;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const entries = await db
    .select()
    .from(entriesTable)
    .orderBy(desc(entriesTable.timestamp));

  const recentEntries = entries.filter(
    (e) => new Date(e.timestamp) >= cutoff,
  );

  const points = recentEntries.map((e) => ({
    timestamp: e.timestamp.toISOString(),
    glucoseBefore: e.glucoseBefore,
    glucoseAfter: e.glucoseAfter ?? null,
    evaluation: e.evaluation ?? null,
  }));

  res.json(GetGlucoseTrendResponse.parse({ points }));
});

export default router;
