import { db, entriesTable } from "@workspace/db";
import { avg, count } from "drizzle-orm";
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

// Real-world T1D seed data — carb ratio 1:30–40 (soft responder)
// All stable meals have glucoseAfter in 85–138 range → evaluation = GOOD
const SEED_DATA: SeedEntry[] = [
  // ── BALANCED meals — personal ratio ~1:33 ──────────────────
  { daysAgo: 1,  glucoseBefore: 108, glucoseAfter: 120, carbsGrams: 55, insulinUnits: 1.5, mealType: "BALANCED",     mealDescription: "Quinoa bowl with veggies",     timeDifferenceMinutes: 120 },
  { daysAgo: 2,  glucoseBefore: 115, glucoseAfter: 130, carbsGrams: 60, insulinUnits: 2.0, mealType: "BALANCED",     mealDescription: "Brown rice and salmon",          timeDifferenceMinutes: 120 },
  { daysAgo: 3,  glucoseBefore: 105, glucoseAfter: 118, carbsGrams: 50, insulinUnits: 1.5, mealType: "BALANCED",     mealDescription: "Turkey wrap",                   timeDifferenceMinutes: 120 },
  { daysAgo: 4,  glucoseBefore: 112, glucoseAfter: 128, carbsGrams: 65, insulinUnits: 2.0, mealType: "BALANCED",     mealDescription: "Pasta with chicken",             timeDifferenceMinutes: 120 },
  { daysAgo: 5,  glucoseBefore: 95,  glucoseAfter: 112, carbsGrams: 45, insulinUnits: 1.5, mealType: "BALANCED",     mealDescription: "Lentil soup and bread",          timeDifferenceMinutes: 120 },
  { daysAgo: 6,  glucoseBefore: 110, glucoseAfter: 125, carbsGrams: 55, insulinUnits: 1.5, mealType: "BALANCED",     mealDescription: "Grilled chicken rice bowl",      timeDifferenceMinutes: 120 },
  { daysAgo: 7,  glucoseBefore: 100, glucoseAfter: 122, carbsGrams: 70, insulinUnits: 2.0, mealType: "BALANCED",     mealDescription: "Couscous with vegetables",       timeDifferenceMinutes: 120 },
  { daysAgo: 8,  glucoseBefore: 98,  glucoseAfter: 114, carbsGrams: 48, insulinUnits: 1.5, mealType: "BALANCED",     mealDescription: "Mixed grain bowl",               timeDifferenceMinutes: 120 },
  { daysAgo: 10, glucoseBefore: 112, glucoseAfter: 126, carbsGrams: 58, insulinUnits: 2.0, mealType: "BALANCED",     mealDescription: "Sweet potato and chicken",       timeDifferenceMinutes: 120 },
  { daysAgo: 13, glucoseBefore: 105, glucoseAfter: 136, carbsGrams: 72, insulinUnits: 2.0, mealType: "BALANCED",     mealDescription: "Pasta primavera",                timeDifferenceMinutes: 120 },

  // ── FAST CARBS — ratio ~1:30, slight spike risk ─────────────
  { daysAgo: 4,  glucoseBefore: 110, glucoseAfter: 132, carbsGrams: 75, insulinUnits: 2.5, mealType: "FAST_CARBS",   mealDescription: "Burger with fries",              timeDifferenceMinutes: 90 },
  { daysAgo: 9,  glucoseBefore: 118, glucoseAfter: 134, carbsGrams: 65, insulinUnits: 2.0, mealType: "FAST_CARBS",   mealDescription: "Bread and jam",                  timeDifferenceMinutes: 90 },
  { daysAgo: 15, glucoseBefore: 105, glucoseAfter: 128, carbsGrams: 80, insulinUnits: 2.5, mealType: "FAST_CARBS",   mealDescription: "Sushi rolls",                    timeDifferenceMinutes: 90 },
  // Bad fast carb entry — underdose (excluded by stability filter)
  { daysAgo: 2,  glucoseBefore: 88,  glucoseAfter: 195, carbsGrams: 80, insulinUnits: 1.5, mealType: "FAST_CARBS",   mealDescription: "Pizza night (underdosed)",       timeDifferenceMinutes: 90 },

  // ── HIGH FAT — ratio ~1:35, split dose territory ────────────
  { daysAgo: 3,  glucoseBefore: 120, glucoseAfter: 128, carbsGrams: 30, insulinUnits: 1.0, mealType: "HIGH_FAT",     mealDescription: "Avocado eggs on toast",          timeDifferenceMinutes: 150 },
  { daysAgo: 5,  glucoseBefore: 110, glucoseAfter: 120, carbsGrams: 25, insulinUnits: 0.5, mealType: "HIGH_FAT",     mealDescription: "Cheese omelette",                timeDifferenceMinutes: 150 },
  { daysAgo: 8,  glucoseBefore: 105, glucoseAfter: 118, carbsGrams: 35, insulinUnits: 1.0, mealType: "HIGH_FAT",     mealDescription: "Salmon with nuts salad",         timeDifferenceMinutes: 150 },
  // High fat overdose — excluded by stability filter (hypo)
  { daysAgo: 11, glucoseBefore: 130, glucoseAfter: 62,  carbsGrams: 40, insulinUnits: 3.0, mealType: "HIGH_FAT",     mealDescription: "Pulled pork tacos (overdosed)",  timeDifferenceMinutes: 150 },

  // ── HIGH PROTEIN — ratio ~1:38 ──────────────────────────────
  { daysAgo: 7,  glucoseBefore: 115, glucoseAfter: 122, carbsGrams: 25, insulinUnits: 0.5, mealType: "HIGH_PROTEIN", mealDescription: "Greek yogurt and nuts",           timeDifferenceMinutes: 120 },
  { daysAgo: 10, glucoseBefore: 108, glucoseAfter: 115, carbsGrams: 20, insulinUnits: 0.5, mealType: "HIGH_PROTEIN", mealDescription: "Egg white omelette",              timeDifferenceMinutes: 120 },
  { daysAgo: 14, glucoseBefore: 122, glucoseAfter: 134, carbsGrams: 35, insulinUnits: 1.0, mealType: "HIGH_PROTEIN", mealDescription: "Tuna salad wrap",                timeDifferenceMinutes: 120 },
];

// Expected avg carb ratio for stable entries with correct data — should be > 25 g/u
const CORRECT_RATIO_MIN = 25;

export async function seedIfEmpty(): Promise<void> {
  // Check whether existing data looks correctly calibrated
  // If avg(carbs/insulin) for entries is < 25 g/u the old bad seed exists — reset
  const allRows = await db.select().from(entriesTable);

  const stableRows = allRows.filter(
    (e) =>
      e.evaluation === "GOOD" &&
      e.glucoseAfter != null &&
      e.glucoseAfter >= 80 &&
      e.glucoseAfter <= 175 &&
      e.insulinUnits > 0 &&
      e.carbsGrams > 0,
  );

  const existingAvgRatio =
    stableRows.length > 0
      ? stableRows.reduce((sum, e) => sum + e.carbsGrams / e.insulinUnits, 0) / stableRows.length
      : 0;

  const needsReset =
    allRows.length === 0 ||
    (stableRows.length > 0 && existingAvgRatio < CORRECT_RATIO_MIN);

  if (!needsReset) return;

  // Clear all existing entries and reseed with correct data
  await db.delete(entriesTable);

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
