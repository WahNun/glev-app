import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, entriesTable } from "@workspace/db";
import {
  GetRecommendationBody,
  GetRecommendationResponse,
} from "@workspace/api-zod";
import { calculatePersonalBolus } from "../lib/recommendation";

const router: IRouter = Router();

router.post("/recommendations", async (req, res): Promise<void> => {
  const parsed = GetRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { carbsGrams, glucoseBefore, mealType } = parsed.data;

  // Pass ALL entries sorted newest-first so the engine can use RECENT/SIMILAR/GLOBAL groups
  const allEntries = await db
    .select()
    .from(entriesTable)
    .orderBy(desc(entriesTable.timestamp));

  const recommendation = calculatePersonalBolus(
    carbsGrams,
    glucoseBefore,
    mealType,
    allEntries,
  );

  // Return full result including extended fields not yet in Zod schema
  res.json({
    ...GetRecommendationResponse.parse(recommendation),
    similarMealCount: recommendation.similarMealCount,
    recentCount: recommendation.recentCount,
    carbRatio: recommendation.carbRatio,
    cappedForSafety: recommendation.cappedForSafety,
  });
});

export default router;
