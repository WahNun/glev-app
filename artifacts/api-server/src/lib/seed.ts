import { db, entriesTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { calculateMetrics } from "./calculation";

interface SeedEntry {
  daysAgo: number;
  glucoseBefore: number;
  glucoseAfter: number;
  carbsGrams: number;
  insulinUnits: number;
  mealType: string;
  mealDescription: string;
  timeDifferenceMinutes: number;
}

const SEED_DATA: SeedEntry[] = [
  // Balanced meals — mostly GOOD with ratio ~1:17
  { daysAgo: 1, glucoseBefore: 108, glucoseAfter: 122, carbsGrams: 55, insulinUnits: 3.5, mealType: "BALANCED", mealDescription: "Quinoa bowl with veggies", timeDifferenceMinutes: 120 },
  { daysAgo: 2, glucoseBefore: 115, glucoseAfter: 130, carbsGrams: 60, insulinUnits: 3.5, mealType: "BALANCED", mealDescription: "Brown rice and salmon", timeDifferenceMinutes: 120 },
  { daysAgo: 3, glucoseBefore: 105, glucoseAfter: 118, carbsGrams: 50, insulinUnits: 3.0, mealType: "BALANCED", mealDescription: "Turkey wrap", timeDifferenceMinutes: 120 },
  { daysAgo: 4, glucoseBefore: 120, glucoseAfter: 138, carbsGrams: 65, insulinUnits: 4.0, mealType: "BALANCED", mealDescription: "Pasta with chicken", timeDifferenceMinutes: 120 },
  { daysAgo: 5, glucoseBefore: 95, glucoseAfter: 115, carbsGrams: 45, insulinUnits: 2.5, mealType: "BALANCED", mealDescription: "Lentil soup and bread", timeDifferenceMinutes: 120 },
  { daysAgo: 6, glucoseBefore: 112, glucoseAfter: 125, carbsGrams: 55, insulinUnits: 3.5, mealType: "BALANCED", mealDescription: "Grilled chicken rice bowl", timeDifferenceMinutes: 120 },
  { daysAgo: 7, glucoseBefore: 100, glucoseAfter: 128, carbsGrams: 70, insulinUnits: 4.5, mealType: "BALANCED", mealDescription: "Couscous with vegetables", timeDifferenceMinutes: 120 },

  // Fast carb meals
  { daysAgo: 2, glucoseBefore: 88, glucoseAfter: 160, carbsGrams: 80, insulinUnits: 5.0, mealType: "FAST_CARBS", mealDescription: "Pizza slice x3", timeDifferenceMinutes: 90 },
  { daysAgo: 4, glucoseBefore: 110, glucoseAfter: 135, carbsGrams: 75, insulinUnits: 5.0, mealType: "FAST_CARBS", mealDescription: "Burger with fries", timeDifferenceMinutes: 90 },
  { daysAgo: 6, glucoseBefore: 105, glucoseAfter: 145, carbsGrams: 85, insulinUnits: 5.5, mealType: "FAST_CARBS", mealDescription: "Sushi rolls", timeDifferenceMinutes: 90 },
  { daysAgo: 9, glucoseBefore: 118, glucoseAfter: 128, carbsGrams: 65, insulinUnits: 4.0, mealType: "FAST_CARBS", mealDescription: "Bread and jam", timeDifferenceMinutes: 90 },
  { daysAgo: 12, glucoseBefore: 95, glucoseAfter: 190, carbsGrams: 80, insulinUnits: 4.0, mealType: "FAST_CARBS", mealDescription: "Pancakes with syrup", timeDifferenceMinutes: 90 },

  // High fat meals
  { daysAgo: 3, glucoseBefore: 120, glucoseAfter: 132, carbsGrams: 30, insulinUnits: 2.0, mealType: "HIGH_FAT", mealDescription: "Avocado eggs on toast", timeDifferenceMinutes: 150 },
  { daysAgo: 5, glucoseBefore: 110, glucoseAfter: 128, carbsGrams: 25, insulinUnits: 1.5, mealType: "HIGH_FAT", mealDescription: "Cheese omelette", timeDifferenceMinutes: 150 },
  { daysAgo: 8, glucoseBefore: 105, glucoseAfter: 118, carbsGrams: 35, insulinUnits: 2.5, mealType: "HIGH_FAT", mealDescription: "Salmon with nuts salad", timeDifferenceMinutes: 150 },
  { daysAgo: 11, glucoseBefore: 130, glucoseAfter: 160, carbsGrams: 40, insulinUnits: 2.0, mealType: "HIGH_FAT", mealDescription: "Pulled pork tacos", timeDifferenceMinutes: 150 },

  // High protein meals
  { daysAgo: 4, glucoseBefore: 130, glucoseAfter: 125, carbsGrams: 30, insulinUnits: 6.0, mealType: "HIGH_PROTEIN", mealDescription: "Grilled chicken breast", timeDifferenceMinutes: 120 },
  { daysAgo: 7, glucoseBefore: 115, glucoseAfter: 130, carbsGrams: 25, insulinUnits: 2.0, mealType: "HIGH_PROTEIN", mealDescription: "Greek yogurt and nuts", timeDifferenceMinutes: 120 },
  { daysAgo: 10, glucoseBefore: 108, glucoseAfter: 122, carbsGrams: 20, insulinUnits: 1.5, mealType: "HIGH_PROTEIN", mealDescription: "Egg white omelette", timeDifferenceMinutes: 120 },
  { daysAgo: 14, glucoseBefore: 122, glucoseAfter: 135, carbsGrams: 35, insulinUnits: 2.5, mealType: "HIGH_PROTEIN", mealDescription: "Tuna salad wrap", timeDifferenceMinutes: 120 },

  // A few more balanced to pad recent history
  { daysAgo: 8, glucoseBefore: 98, glucoseAfter: 110, carbsGrams: 48, insulinUnits: 3.0, mealType: "BALANCED", mealDescription: "Mixed grain bowl", timeDifferenceMinutes: 120 },
  { daysAgo: 10, glucoseBefore: 112, glucoseAfter: 126, carbsGrams: 58, insulinUnits: 3.5, mealType: "BALANCED", mealDescription: "Sweet potato and chicken", timeDifferenceMinutes: 120 },
  { daysAgo: 13, glucoseBefore: 105, glucoseAfter: 140, carbsGrams: 72, insulinUnits: 4.5, mealType: "BALANCED", mealDescription: "Pasta primavera", timeDifferenceMinutes: 120 },
];

export async function seedIfEmpty(): Promise<void> {
  const [{ value: existingCount }] = await db
    .select({ value: count() })
    .from(entriesTable);

  if (existingCount >= 15) {
    return;
  }

  const now = new Date();

  const rows = SEED_DATA.map((s) => {
    const timestamp = new Date(now.getTime() - s.daysAgo * 24 * 60 * 60 * 1000);
    const { delta, speed, evaluation } = calculateMetrics(
      s.glucoseBefore,
      s.glucoseAfter,
      s.timeDifferenceMinutes,
      s.insulinUnits,
      s.carbsGrams,
    );

    return {
      timestamp,
      glucoseBefore: s.glucoseBefore,
      glucoseAfter: s.glucoseAfter,
      carbsGrams: s.carbsGrams,
      insulinUnits: s.insulinUnits,
      mealType: s.mealType,
      mealDescription: s.mealDescription,
      timeDifferenceMinutes: s.timeDifferenceMinutes,
      delta,
      speed,
      evaluation,
      notes: null,
    };
  });

  await db.insert(entriesTable).values(rows);
}
