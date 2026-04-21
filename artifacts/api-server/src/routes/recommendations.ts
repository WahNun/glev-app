import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, entriesTable } from "@workspace/db";
import {
  GetRecommendationBody,
  GetRecommendationResponse,
} from "@workspace/api-zod";
import { generateRecommendation } from "../lib/recommendation";

const router: IRouter = Router();

router.post("/recommendations", async (req, res): Promise<void> => {
  const parsed = GetRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { carbsGrams, glucoseBefore, mealType } = parsed.data;

  const similarEntries = await db
    .select()
    .from(entriesTable)
    .where(eq(entriesTable.mealType, mealType));

  const recommendation = generateRecommendation(
    carbsGrams,
    glucoseBefore,
    mealType,
    similarEntries,
  );

  res.json(GetRecommendationResponse.parse(recommendation));
});

export default router;
