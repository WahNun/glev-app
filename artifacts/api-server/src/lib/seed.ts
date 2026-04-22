import { db, entriesTable } from "@workspace/db";
import { calculateMetrics } from "./calculation";

// ── User's real dataset (April 2026) ────────────────────────────
// Evaluations preserved exactly as recorded by the user.
// Carb ranges (e.g. 64-89) use the midpoint.
const SEED_DATA = [
  {
    timestamp: new Date("2026-04-17T21:40:00"),
    glucoseBefore: 112, glucoseAfter: 56,
    carbsGrams: 76, insulinUnits: 3,
    mealType: "BALANCED",
    mealDescription: "1 Ox Tongue Croquette, honey mustard, 8 olives, 1 oyster, 5 ravioli, 100g green beans",
    timeDifferenceMinutes: 73,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-18T09:34:00"),
    glucoseBefore: 114, glucoseAfter: 97,
    carbsGrams: 62, insulinUnits: 2,
    mealType: "HIGH_PROTEIN",
    mealDescription: "150g chia pudding, 100g Greek yogurt, 45g blueberries, 45g raspberries, 18g mixed nuts, 32g Bettery protein shake, 55g wholegrain rye bread, 125g mozzarella, 40g cream cheese, 120g tomato, 50g egg",
    timeDifferenceMinutes: 65,
    userEvaluation: "GOOD",
  },
  {
    timestamp: new Date("2026-04-18T14:40:00"),
    glucoseBefore: 120, glucoseAfter: 65,
    carbsGrams: 40, insulinUnits: 3,
    mealType: "HIGH_PROTEIN",
    mealDescription: "234g chicken breast, 158g broccoli, 90g roasted chickpeas, 32g BETTERY protein shake, 8g olive oil, 6g butter, 4g garlic",
    timeDifferenceMinutes: 56,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-18T20:30:00"),
    glucoseBefore: 145, glucoseAfter: 67,
    carbsGrams: 49, insulinUnits: 3,
    mealType: "BALANCED",
    mealDescription: "90g mackerel, 55g fries, 70g dark bread, 75g seafood rice, 20g olives, 35g salad, 20g creamed spinach, 8g Portuguese onion olive oil sauce",
    timeDifferenceMinutes: 83,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-19T11:12:00"),
    glucoseBefore: 71, glucoseAfter: 62,
    carbsGrams: 67, insulinUnits: 2,
    mealType: "HIGH_PROTEIN",
    mealDescription: "131g chia pudding, 126g stracciatella yogurt, 125g light mozzarella, 125g tomato, 48g rye bread, 40g Portuguese fresh cheese, 60g egg, 40g blueberries, 35g raspberries, 20g mixed nuts, 6g olive oil, 32g BETTERY vanilla plant protein powder, 15g gummy candy",
    timeDifferenceMinutes: 73,
    userEvaluation: "GOOD",
  },
  {
    timestamp: new Date("2026-04-19T15:01:00"),
    glucoseBefore: 109, glucoseAfter: 66,
    carbsGrams: 42, insulinUnits: 2,
    mealType: "BALANCED",
    mealDescription: "75g pita bread, 110g kafta, 18g tahini sauce, 35g mixed vegetables, 90g tabbouleh salad",
    timeDifferenceMinutes: 62,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-19T21:55:00"),
    glucoseBefore: 120, glucoseAfter: 81,
    carbsGrams: 93, insulinUnits: 2,
    mealType: "BALANCED",
    mealDescription: "218g fennel pear salad, 139g broccoli, 95g roasted chickpeas, 69g halloumi, 115g potato wedges, 60g egg",
    timeDifferenceMinutes: 65,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-20T10:43:00"),
    glucoseBefore: 86, glucoseAfter: 120,
    carbsGrams: 51, insulinUnits: 1,
    mealType: "HIGH_PROTEIN",
    mealDescription: "60g chia pudding, 129g Greek yogurt, 33g blueberries, 34g raspberries, 125g light mozzarella, 125g tomato, 48g rye bread, 6g olive oil, 60g egg, 32g BETTERY vanilla plant protein powder, 37g mixed nuts, 2g cinnamon",
    timeDifferenceMinutes: 59,
    userEvaluation: "UNDERDOSE",
  },
  {
    timestamp: new Date("2026-04-20T16:36:00"),
    glucoseBefore: 118, glucoseAfter: 256,
    carbsGrams: 82, insulinUnits: 1,
    mealType: "FAST_CARBS",
    mealDescription: "80g granola, 120g banana, 20g mixed nuts, 150g coconut rice milk",
    timeDifferenceMinutes: 88,
    userEvaluation: "UNDERDOSE",
  },
  {
    timestamp: new Date("2026-04-20T20:28:00"),
    glucoseBefore: 196, glucoseAfter: 96,
    carbsGrams: 66, insulinUnits: 3,
    mealType: "BALANCED",
    mealDescription: "200g beef steak, 150g turnip greens, 80g cooked brown rice, 140g potatoes, 60g mixed salad, 45g white bread",
    timeDifferenceMinutes: 86,
    userEvaluation: "OVERDOSE",
  },
  {
    timestamp: new Date("2026-04-21T14:20:00"),
    glucoseBefore: 97, glucoseAfter: 96,
    carbsGrams: 59, insulinUnits: 1,
    mealType: "FAST_CARBS",
    mealDescription: "40g granola, 20g blueberries, 33g raspberries, 160g yogurt, 38g mixed nuts, 130g banana, 60g egg, 32g BETTERY vanilla plant protein powder",
    timeDifferenceMinutes: 59,
    userEvaluation: "GOOD",
  },
  {
    timestamp: new Date("2026-04-21T15:19:00"),
    glucoseBefore: 74, glucoseAfter: 150,
    carbsGrams: 74, insulinUnits: 1,
    mealType: "FAST_CARBS",
    mealDescription: "95g cinnamon roll, 250g matcha latte, 4g sugar",
    timeDifferenceMinutes: 61,
    userEvaluation: "UNDERDOSE",
  },
  {
    timestamp: new Date("2026-04-21T20:53:00"),
    glucoseBefore: 121, glucoseAfter: 60,
    carbsGrams: 157, insulinUnits: 3,
    mealType: "FAST_CARBS",
    mealDescription: "294g pulao rice, 400g mango lassi, 32g BETTERY vanilla plant protein powder, 493g chicken korma, 83g yogurt cucumber tomato salad",
    timeDifferenceMinutes: 72,
    userEvaluation: "OVERDOSE",
  },
];

// Version token — change this string to force a full reseed
const SEED_VERSION = "user-real-dataset-v1";

export async function seedIfEmpty(): Promise<void> {
  const allRows = await db.select().from(entriesTable);

  // Detect whether the current data is the user's real dataset by checking
  // for a known meal description from their data
  const hasUserData = allRows.some(
    (r) => r.mealDescription?.includes("Ox Tongue Croquette") ||
            r.mealDescription?.includes("pulao rice") ||
            r.mealDescription?.includes("cinnamon roll")
  );

  if (hasUserData && allRows.length >= SEED_DATA.length) return;

  // Replace all existing entries with user's real dataset
  await db.delete(entriesTable);

  const rows = SEED_DATA.map((s) => {
    const { delta, speed } = calculateMetrics(
      s.glucoseBefore,
      s.glucoseAfter,
      s.timeDifferenceMinutes,
      s.insulinUnits,
      s.carbsGrams,
    );

    return {
      timestamp: s.timestamp,
      glucoseBefore: s.glucoseBefore,
      glucoseAfter: s.glucoseAfter,
      carbsGrams: s.carbsGrams,
      insulinUnits: s.insulinUnits,
      mealType: s.mealType,
      mealDescription: s.mealDescription,
      timeDifferenceMinutes: s.timeDifferenceMinutes,
      delta,
      speed,
      evaluation: s.userEvaluation,
      notes: null,
    };
  });

  await db.insert(entriesTable).values(rows);
}
