/**
 * lib/ai/alcoholFallback.ts
 *
 * Server-side alcohol detection fallback.
 * When Mistral omits alcohol_g for clearly alcoholic items, this module
 * estimates it from the item name and gram weight using a keyword table.
 *
 * Rationale: pure prompt-compliance is insufficient — Mistral is inconsistent
 * with items like "Bier", "Wein", "Wodka". A deterministic backend fallback
 * ensures dual-emission (alcohol influence log) fires reliably.
 * See DECISIONS.md § D-003.
 */

export type EnrichedRawItem = {
  name: string;
  grams: number;
  alcohol_g?: number;
};

/** Keywords that force alcohol_g = 0 regardless of other matches. */
const EXEMPT_KEYWORDS = [
  "alkoholfrei",
  "non-alcoholic",
  "alcohol-free",
  "alkohol frei",
  "0,0%",
  "0.0%",
];

/**
 * Ordered match table — first match wins.
 * ABV = alcohol-by-weight fraction (not vol-%; pure ethanol ~0.789 g/ml,
 * so a 5 vol-% beer ≈ 5 * 0.789 / 100 * volumeInMl * density ≈ grams * 0.04).
 */
export const ALCOHOL_MATCH_TABLE: Array<{ re: RegExp; abv: number; label: string }> = [
  { re: /starkbier|doppelbock|bock(?!wurst)/i,                                        abv: 0.075, label: "Starkbier"    },
  { re: /weizen|hefeweizen|wei[sß]bier/i,                                              abv: 0.04,  label: "Weizenbier"  },
  { re: /bier|pils|lager|helles|beer/i,                                                abv: 0.04,  label: "Bier"        },
  { re: /sekt|prosecco|champagner|sparkling\s*wine/i,                                  abv: 0.10,  label: "Sekt"        },
  { re: /rotwein|wei[sß]wein|ros[eé]|red\s*wine|white\s*wine|wine|wein/i,             abv: 0.10,  label: "Wein"        },
  { re: /aperol\s*spritz/i,                                                             abv: 0.06,  label: "Aperol Spritz" },
  { re: /schnaps|vodka|wodka|gin\b|whiskey|whisky|rum\b|tequila|spirit|spirituos/i,   abv: 0.35,  label: "Spirits"     },
  { re: /baileys|lik[oö]r|liqueur/i,                                                   abv: 0.17,  label: "Likör"       },
  { re: /mojito|caipirinha/i,                                                           abv: 0.08,  label: "Cocktail"    },
  { re: /aperol|aperitif|digestif/i,                                                    abv: 0.11,  label: "Aperitif"    },
  { re: /sake/i,                                                                         abv: 0.12,  label: "Sake"        },
  { re: /cocktail/i,                                                                     abv: 0.08,  label: "Cocktail"    },
];

/**
 * Processes a list of raw items from Mistral's tool response and fills in
 * missing `alcohol_g` values for items whose names match alcohol keywords.
 *
 * Rules:
 * - If Mistral already set `alcohol_g > 0` → keep it unchanged.
 * - If item name contains a non-alcoholic keyword → force `alcohol_g = 0`.
 * - If item name matches an alcohol keyword → estimate from abv × grams.
 * - Otherwise → no `alcohol_g` field set.
 */
export function applyAlcoholFallback(
  items: Array<{ name: string; grams: number; alcohol_g?: unknown }>,
): EnrichedRawItem[] {
  return items.map((item) => {
    const { name, grams } = item;
    const existing = typeof item.alcohol_g === "number" ? item.alcohol_g : null;

    if (existing !== null && existing > 0) {
      return { name, grams, alcohol_g: existing };
    }

    const nameLower = name.toLowerCase();

    const isExempt = EXEMPT_KEYWORDS.some((kw) => nameLower.includes(kw));
    if (isExempt) {
      if (existing !== null && existing !== 0) {
        console.log(
          `[alcohol-fallback] force alcohol_g=0 for item='${name}' (non-alcoholic keyword)`,
        );
      }
      return { name, grams, alcohol_g: 0 };
    }

    for (const { re, abv, label } of ALCOHOL_MATCH_TABLE) {
      if (re.test(name)) {
        const estimated = Math.round(grams * abv * 10) / 10;
        console.log(
          `[alcohol-fallback] auto-set alcohol_g=${estimated} for item='${name}' (${label}, ${(abv * 100).toFixed(1)}% ABW × ${grams}g)`,
        );
        return { name, grams, alcohol_g: estimated };
      }
    }

    return { name, grams };
  });
}

/** Sums alcohol_g across enriched items. Returns 0 if none are alcoholic. */
export function sumAlcoholG(items: EnrichedRawItem[]): number {
  return items.reduce(
    (sum, it) => sum + (typeof it.alcohol_g === "number" && it.alcohol_g > 0 ? it.alcohol_g : 0),
    0,
  );
}
