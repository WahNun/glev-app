import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ── Portion → grams mapping ───────────────────────────────────────
const GENERIC_PORTIONS: Record<string, number> = {
  handful: 45,
  small: 80,
  medium: 130,
  large: 200,
  tablespoon: 15,
  tbsp: 15,
  teaspoon: 5,
  tsp: 5,
  cup: 240,
  slice: 30,
  piece: 100,
  bowl: 250,
  portion: 150,
  serving: 100,
};

const FOOD_PORTION_OVERRIDES: Record<string, Record<string, number>> = {
  blueberries:   { handful: 50, cup: 148 },
  strawberries:  { handful: 60, cup: 152 },
  raspberries:   { handful: 50, cup: 123 },
  banana:        { small: 80, medium: 120, large: 160 },
  apple:         { small: 130, medium: 180, large: 220 },
  nuts:          { handful: 28, tablespoon: 15 },
  "mixed nuts":  { handful: 28, tablespoon: 15 },
  yogurt:        { cup: 245, small: 120, medium: 170 },
  granola:       { tablespoon: 15, cup: 120 },
  rice:          { cup: 195, bowl: 200 },
  pasta:         { cup: 140, bowl: 200 },
  chicken:       { piece: 175, medium: 175 },
  bread:         { slice: 28 },
};

function portionToGrams(portion: string, food: string): number {
  const p = portion.toLowerCase().trim();
  const f = food.toLowerCase().trim();

  const gramMatch = p.match(/^(\d+(?:\.\d+)?)\s*(?:g|grams?)$/);
  if (gramMatch) return parseFloat(gramMatch[1]);

  const mlMatch = p.match(/^(\d+(?:\.\d+)?)\s*(?:ml|milliliter)$/);
  if (mlMatch) return parseFloat(mlMatch[1]);

  for (const [foodKey, portions] of Object.entries(FOOD_PORTION_OVERRIDES)) {
    if (f.includes(foodKey)) {
      for (const [portionKey, grams] of Object.entries(portions)) {
        if (p.includes(portionKey)) return grams;
      }
    }
  }

  for (const [portionKey, grams] of Object.entries(GENERIC_PORTIONS)) {
    if (p.includes(portionKey)) return grams;
  }

  return 100;
}

// ── USDA FoodData Central lookup ──────────────────────────────────
const PROCESSED_FOODS = /yogurt|cheese|bread|pasta|rice|cereal|granola|oat|milk|cream|butter|oil|sauce|soup|juice|soda|protein|powder|bar|cookie|cracker|chip|pretzel/i;

async function lookupUSDA(foodName: string, grams: number) {
  const apiKey = process.env.USDA_API_KEY ?? "DEMO_KEY";
  const appendRaw = !PROCESSED_FOODS.test(foodName) && !/\bcooked\b|\bfried\b|\broasted\b/i.test(foodName);
  const queryStr = appendRaw ? `${foodName} raw` : foodName;
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(queryStr)}&api_key=${apiKey}&pageSize=5&dataType=Foundation,SR%20Legacy`;

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`USDA ${res.status}`);

  const data = await res.json() as any;
  const foods: any[] = data.foods ?? [];
  if (foods.length === 0) throw new Error("not found");
  const food = foods.find((f) => /\braw\b/i.test(f.description)) ?? foods[0];

  const get = (nameFragment: string): number => {
    const n = (food.foodNutrients as any[])?.find((n) =>
      n.nutrientName?.toLowerCase().includes(nameFragment.toLowerCase())
    );
    return n?.value ?? 0;
  };

  const factor = grams / 100;
  return {
    resolvedName: food.description as string,
    grams,
    carbs:    +(get("carbohydrate") * factor).toFixed(1),
    fiber:    +(get("fiber") * factor).toFixed(1),
    protein:  +(get("protein") * factor).toFixed(1),
    fat:      +(get("total lipid") * factor).toFixed(1),
    calories: +(get("energy") * factor).toFixed(0),
    source:   "USDA",
  };
}

// ── Rough estimation fallback ─────────────────────────────────────
const ESTIMATED_PER_100G: Record<string, {carbs:number;fiber:number;protein:number;fat:number;calories:number}> = {
  fruit:     { carbs:13, fiber:2,  protein:0.8, fat:0.2, calories:55 },
  vegetable: { carbs:6,  fiber:2,  protein:2,   fat:0.3, calories:30 },
  bread:     { carbs:49, fiber:3,  protein:9,   fat:3,   calories:260 },
  rice:      { carbs:28, fiber:0.4,protein:3,   fat:0.3, calories:130 },
  pasta:     { carbs:25, fiber:1.5,protein:5,   fat:1,   calories:130 },
  meat:      { carbs:0,  fiber:0,  protein:26,  fat:8,   calories:180 },
  fish:      { carbs:0,  fiber:0,  protein:22,  fat:5,   calories:130 },
  dairy:     { carbs:5,  fiber:0,  protein:10,  fat:4,   calories:95 },
  nuts:      { carbs:14, fiber:7,  protein:20,  fat:50,  calories:600 },
  default:   { carbs:20, fiber:2,  protein:5,   fat:3,   calories:120 },
};

function estimateMacros(foodName: string, grams: number) {
  const f = foodName.toLowerCase();
  let base = ESTIMATED_PER_100G.default;
  if (/berry|fruit|banana|apple|mango|berry|grape/i.test(f)) base = ESTIMATED_PER_100G.fruit;
  else if (/salad|broccoli|spinach|vegetable|green beans|kale|tomato/i.test(f)) base = ESTIMATED_PER_100G.vegetable;
  else if (/bread|toast|roll|bun|croissant|bagel/i.test(f)) base = ESTIMATED_PER_100G.bread;
  else if (/rice|pasta|noodle|quinoa|couscous/i.test(f)) base = ESTIMATED_PER_100G.rice;
  else if (/chicken|beef|pork|steak|turkey|lamb|meat/i.test(f)) base = ESTIMATED_PER_100G.meat;
  else if (/fish|salmon|tuna|mackerel|cod|shrimp/i.test(f)) base = ESTIMATED_PER_100G.fish;
  else if (/yogurt|milk|cheese|dairy|cream/i.test(f)) base = ESTIMATED_PER_100G.dairy;
  else if (/nuts|almond|walnut|cashew|peanut/i.test(f)) base = ESTIMATED_PER_100G.nuts;

  const factor = grams / 100;
  return {
    resolvedName: foodName,
    grams,
    carbs:    +(base.carbs    * factor).toFixed(1),
    fiber:    +(base.fiber    * factor).toFixed(1),
    protein:  +(base.protein  * factor).toFixed(1),
    fat:      +(base.fat      * factor).toFixed(1),
    calories: +(base.calories * factor).toFixed(0),
    source:   "estimated",
  };
}

// ── Route ─────────────────────────────────────────────────────────
router.post("/food/macros", async (req, res): Promise<void> => {
  const { foods } = req.body as { foods: { name: string; portion: string }[] };

  if (!Array.isArray(foods) || foods.length === 0) {
    res.status(400).json({ error: "foods array required" });
    return;
  }

  const items = await Promise.all(
    foods.map(async (f) => {
      const grams = portionToGrams(f.portion, f.name);
      try {
        return await lookupUSDA(f.name, grams);
      } catch {
        return { ...estimateMacros(f.name, grams), inputName: f.name };
      }
    })
  );

  const zero = { carbs:0, fiber:0, protein:0, fat:0, calories:0 };
  const totals = items.reduce((acc, item) => ({
    carbs:    +(acc.carbs    + item.carbs).toFixed(1),
    fiber:    +(acc.fiber    + item.fiber).toFixed(1),
    protein:  +(acc.protein  + item.protein).toFixed(1),
    fat:      +(acc.fat      + item.fat).toFixed(1),
    calories: +(acc.calories + Number(item.calories)).toFixed(0),
  }), zero);

  const netCarbs = Math.max(0, +(totals.carbs - totals.fiber).toFixed(1));
  const hasEstimated = items.some((i) => (i as any).source === "estimated");

  res.json({ items, totals: { ...totals, netCarbs }, hasEstimated });
});

export default router;
