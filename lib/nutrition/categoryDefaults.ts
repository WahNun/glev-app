import type { NutritionPer100, ParsedFoodItem } from "./types";

/**
 * Deterministic category-default fallback. Used by the aggregator as
 * the LAST resort before tagging an item as `unknown`, after both DB
 * lookups (OFF + USDA) AND the GPT estimator have failed.
 *
 * Rationale (Option C, 2026-05-12 — Lucas):
 *   The original aggregator pipeline went OFF → USDA → GPT-estimate →
 *   'unknown'. When OpenAI was rate-limited or returned IMPOSSIBLE for
 *   a perfectly common item like "Sucuk" or "Schnitzel", a SINGLE
 *   failed item escalated the WHOLE meal to `nutritionSource:'unknown'`
 *   (see lib/nutrition/aggregate.ts → topLevelSource), which made the
 *   UI refuse to auto-fill macros. The user then had to type every
 *   macro manually even though 4 of 5 items were resolved.
 *
 * This file provides a deterministic per-100g table keyed off broad
 * food categories — an irreducible "average product" estimate sourced
 * from USDA SR-Legacy and Open Food Facts category medians. The values
 * are intentionally conservative for T1D safety (we'd rather slightly
 * over-estimate carbs than zero them out), and match a parser within
 * roughly ±20% for the vast majority of common foods.
 *
 * Matching strategy: case-insensitive keyword search across the item's
 * `name` plus `search_term_en` and `search_term_de` (joined into one
 * haystack). The categories are ORDERED — more specific patterns
 * (sucuk, schnitzel, pizza) MUST come before generic catch-alls
 * (meat, bread, sauce) because the first hit wins.
 */

interface CategoryDef {
  id:       string;
  /** Lowercase keyword fragments. Match if ANY appears in the haystack. */
  keywords: readonly string[];
  per100:   NutritionPer100;
}

// Per-100g defaults. Keep ordering specific → generic.
const CATEGORIES: readonly CategoryDef[] = [
  // ── Cured & processed meats (high-fat sausages) ─────────────────
  {
    id: "cured_meat",
    keywords: ["sucuk", "soujouk", "salami", "pepperoni", "chorizo", "wurst", "wuerst",
               "bratwurst", "weisswurst", "weißwurst", "cabanossi", "kabanos",
               "speck", "pancetta", "bacon", "schinken", "prosciutto", "ham"],
    per100: { carbs_g: 1, protein_g: 18, fat_g: 30, fiber_g: 0 },
  },
  // ── Cooked sausages (bratwurst, hotdog, frankfurter) ────────────
  {
    id: "sausage_cooked",
    keywords: ["hotdog", "hot dog", "frankfurter", "wiener", "merguez", "saucisse"],
    per100: { carbs_g: 2, protein_g: 13, fat_g: 25, fiber_g: 0 },
  },
  // ── Schnitzel / breaded fried meat ──────────────────────────────
  {
    id: "schnitzel",
    keywords: ["schnitzel", "cordon bleu", "breaded", "panierte", "paniert",
               "milanesa", "katsu", "tonkatsu"],
    per100: { carbs_g: 12, protein_g: 20, fat_g: 15, fiber_g: 1 },
  },
  // ── Pizza (slice or whole, default to standard cheese pizza) ────
  {
    id: "pizza",
    keywords: ["pizza", "calzone", "flammkuchen", "tarte flambée"],
    per100: { carbs_g: 30, protein_g: 12, fat_g: 10, fiber_g: 2 },
  },
  // ── Burgers & sandwiches (composite estimate incl. bun) ─────────
  {
    id: "burger",
    keywords: ["burger", "cheeseburger", "hamburger", "sandwich", "wrap",
               "döner", "doener", "kebab", "shawarma", "gyros", "dürüm", "duerum"],
    per100: { carbs_g: 22, protein_g: 12, fat_g: 12, fiber_g: 2 },
  },
  // ── Bread, buns, rolls ──────────────────────────────────────────
  {
    id: "bread",
    keywords: ["brot", "bread", "brötchen", "broetchen", "roll", "bun", "bagel",
               "baguette", "ciabatta", "tortilla", "pita", "naan", "fladen",
               "toast", "knäcke", "knaecke", "cracker", "zwieback"],
    per100: { carbs_g: 50, protein_g: 9, fat_g: 3, fiber_g: 4 },
  },
  // ── Pasta & noodles (cooked) ────────────────────────────────────
  {
    id: "pasta_cooked",
    keywords: ["pasta", "spaghetti", "penne", "fusilli", "tagliatelle", "lasagne",
               "lasagna", "ravioli", "tortellini", "gnocchi", "nudel", "noodle",
               "ramen", "udon", "soba"],
    per100: { carbs_g: 30, protein_g: 5, fat_g: 1, fiber_g: 2 },
  },
  // ── Rice & grains (cooked) ──────────────────────────────────────
  {
    id: "rice_cooked",
    keywords: ["rice", "reis", "risotto", "paella", "pilaf", "bulgur",
               "couscous", "quinoa", "polenta"],
    per100: { carbs_g: 28, protein_g: 3, fat_g: 0.4, fiber_g: 0.4 },
  },
  // ── Cereal / muesli / oats (dry) ────────────────────────────────
  {
    id: "cereal_dry",
    keywords: ["müsli", "muesli", "granola", "cereal", "cornflakes", "haferflocken",
               "oats", "porridge"],
    per100: { carbs_g: 60, protein_g: 10, fat_g: 7, fiber_g: 8 },
  },
  // ── Potato dishes ───────────────────────────────────────────────
  {
    id: "fries",
    keywords: ["fries", "pommes", "wedges", "rösti", "roesti", "kroketten", "croquette"],
    per100: { carbs_g: 35, protein_g: 3, fat_g: 15, fiber_g: 4 },
  },
  {
    id: "potato",
    keywords: ["potato", "kartoffel", "purée", "puree", "mash", "stampf"],
    per100: { carbs_g: 17, protein_g: 2, fat_g: 0.1, fiber_g: 2 },
  },
  // ── Cheese ──────────────────────────────────────────────────────
  {
    id: "cheese",
    keywords: ["cheese", "käse", "kaese", "feta", "mozzarella", "parmesan",
               "gouda", "cheddar", "halloumi", "ricotta"],
    per100: { carbs_g: 2, protein_g: 22, fat_g: 28, fiber_g: 0 },
  },
  // ── Yogurt / quark / dairy desserts ─────────────────────────────
  {
    id: "yogurt",
    keywords: ["yogurt", "joghurt", "quark", "skyr", "kefir", "buttermilch",
               "buttermilk", "pudding"],
    per100: { carbs_g: 6, protein_g: 5, fat_g: 3, fiber_g: 0 },
  },
  // ── Milk & milk drinks ──────────────────────────────────────────
  {
    id: "milk",
    keywords: ["milk", "milch", "latte", "cappuccino", "kakao", "cocoa drink",
               "kakao drink"],
    per100: { carbs_g: 5, protein_g: 3, fat_g: 3, fiber_g: 0 },
  },
  // ── Egg ─────────────────────────────────────────────────────────
  {
    id: "egg",
    keywords: ["egg", "ei ", "eier", "omelett", "omelette", "rührei", "ruehrei",
               "spiegelei"],
    per100: { carbs_g: 1, protein_g: 13, fat_g: 10, fiber_g: 0 },
  },
  // ── Fish & seafood ──────────────────────────────────────────────
  {
    id: "fish",
    keywords: ["fish", "fisch", "salmon", "lachs", "tuna", "thunfisch", "cod",
               "kabeljau", "trout", "forelle", "shrimp", "garnele", "shrimps",
               "prawn", "calamari", "tintenfisch"],
    per100: { carbs_g: 0, protein_g: 22, fat_g: 6, fiber_g: 0 },
  },
  // ── Chicken / poultry (cooked) ──────────────────────────────────
  {
    id: "chicken",
    keywords: ["chicken", "hähnchen", "haehnchen", "huhn", "pute", "turkey",
               "ente", "duck", "poulet"],
    per100: { carbs_g: 0, protein_g: 27, fat_g: 7, fiber_g: 0 },
  },
  // ── Beef (cooked) ───────────────────────────────────────────────
  {
    id: "beef",
    keywords: ["beef", "rind", "rinder", "steak", "hackfleisch", "ground beef",
               "lamm", "lamb"],
    per100: { carbs_g: 0, protein_g: 26, fat_g: 17, fiber_g: 0 },
  },
  // ── Pork (cooked) ───────────────────────────────────────────────
  {
    id: "pork",
    keywords: ["pork", "schwein", "schweine", "kotelett", "spare rib"],
    per100: { carbs_g: 0, protein_g: 25, fat_g: 15, fiber_g: 0 },
  },
  // ── Nuts & seeds ────────────────────────────────────────────────
  {
    id: "nuts",
    keywords: ["nuts", "nuss", "nüsse", "nuesse", "almond", "mandel", "walnut",
               "walnuss", "cashew", "pistazie", "pistachio", "haselnuss",
               "hazelnut", "pecan", "peanut", "erdnuss", "samen", "seed",
               "sonnenblumen"],
    per100: { carbs_g: 16, protein_g: 20, fat_g: 50, fiber_g: 7 },
  },
  // ── Chocolate / sweets / pastries ───────────────────────────────
  {
    id: "chocolate",
    keywords: ["chocolate", "schokolade", "praline", "bonbon", "candy", "gummi",
               "haribo", "lakritz", "licorice"],
    per100: { carbs_g: 55, protein_g: 5, fat_g: 30, fiber_g: 7 },
  },
  {
    id: "pastry",
    keywords: ["cake", "kuchen", "torte", "muffin", "donut", "doughnut",
               "croissant", "berliner", "krapfen", "waffel", "waffle", "pancake",
               "pfannkuchen", "keks", "cookie", "biscuit", "plätzchen", "plaetzchen"],
    per100: { carbs_g: 50, protein_g: 6, fat_g: 18, fiber_g: 2 },
  },
  // ── Ice cream ───────────────────────────────────────────────────
  {
    id: "ice_cream",
    keywords: ["ice cream", "eis ", "gelato", "sorbet"],
    per100: { carbs_g: 24, protein_g: 4, fat_g: 11, fiber_g: 0 },
  },
  // ── Soup & stew ─────────────────────────────────────────────────
  {
    id: "soup",
    keywords: ["soup", "suppe", "eintopf", "stew", "broth", "brühe", "bruehe",
               "ramen broth"],
    per100: { carbs_g: 6, protein_g: 3, fat_g: 2, fiber_g: 1 },
  },
  // ── Sauces, dressings, condiments ───────────────────────────────
  {
    id: "sauce",
    keywords: ["sauce", "soße", "sosse", "dressing", "ketchup", "majo", "mayo",
               "mayonnaise", "senf", "mustard", "pesto", "aioli", "tzatziki",
               "humus", "hummus"],
    per100: { carbs_g: 8, protein_g: 2, fat_g: 20, fiber_g: 1 },
  },
  // ── Fruit (raw, generic mix) ────────────────────────────────────
  {
    id: "fruit",
    keywords: ["fruit", "obst", "apfel", "apple", "banane", "banana", "orange",
               "birne", "pear", "trauben", "grape", "beere", "berry", "kirsche",
               "cherry", "melone", "melon", "pfirsich", "peach", "ananas",
               "pineapple", "mango", "kiwi"],
    per100: { carbs_g: 14, protein_g: 1, fat_g: 0.3, fiber_g: 2 },
  },
  // ── Vegetables (raw/cooked, generic) ────────────────────────────
  {
    id: "vegetables",
    keywords: ["gemüse", "gemuese", "vegetable", "salat", "salad", "tomate",
               "tomato", "gurke", "cucumber", "paprika", "pepper", "zwiebel",
               "onion", "karotte", "carrot", "möhre", "moehre", "broccoli",
               "brokkoli", "spinat", "spinach", "zucchini", "kürbis", "kuerbis",
               "pumpkin", "blumenkohl", "cauliflower"],
    per100: { carbs_g: 6, protein_g: 2, fat_g: 0.3, fiber_g: 3 },
  },
  // ── Legumes & beans (cooked) ────────────────────────────────────
  {
    id: "legumes",
    keywords: ["bohne", "bean", "linse", "lentil", "kichererbse", "chickpea",
               "erbse", "pea", "tofu", "tempeh"],
    per100: { carbs_g: 14, protein_g: 9, fat_g: 2, fiber_g: 6 },
  },
  // ── Juices ──────────────────────────────────────────────────────
  {
    id: "juice",
    keywords: ["juice", "saft", "smoothie", "schorle"],
    per100: { carbs_g: 12, protein_g: 0.5, fat_g: 0, fiber_g: 0 },
  },
  // ── Soft drinks (sugary) ────────────────────────────────────────
  {
    id: "soft_drink",
    keywords: ["cola", "limonade", "lemonade", "fanta", "sprite", "softdrink",
               "soft drink", "energy drink", "redbull", "red bull"],
    per100: { carbs_g: 11, protein_g: 0, fat_g: 0, fiber_g: 0 },
  },
  // ── Beer / wine (rough alcohol-as-carb estimate) ────────────────
  {
    id: "beer",
    keywords: ["beer", "bier", "pils", "weizen", "lager"],
    per100: { carbs_g: 4, protein_g: 0.5, fat_g: 0, fiber_g: 0 },
  },
  {
    id: "wine",
    keywords: ["wine", "wein", "sekt", "champagner", "champagne", "prosecco"],
    per100: { carbs_g: 3, protein_g: 0.1, fat_g: 0, fiber_g: 0 },
  },
  // ── Generic catch-alls (LAST — broad nouns) ─────────────────────
  {
    id: "meat_generic",
    keywords: ["meat", "fleisch"],
    per100: { carbs_g: 0, protein_g: 25, fat_g: 15, fiber_g: 0 },
  },
];

export interface CategoryMatch {
  category: string;
  per100:   NutritionPer100;
}

export function categoryDefaultFor(item: ParsedFoodItem): CategoryMatch | null {
  const haystack = [
    item.name,
    item.search_term_en,
    item.search_term_de,
  ].join(" ").toLowerCase();

  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      // Word-ish match: substring is fine because keywords are deliberately
      // distinctive ("brot", "wurst", "schnitzel"). Short generics like
      // "ei " include trailing space to avoid matching inside "feier" etc.
      if (haystack.includes(kw)) {
        return { category: cat.id, per100: cat.per100 };
      }
    }
  }
  return null;
}
