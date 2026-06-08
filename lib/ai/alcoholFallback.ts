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
  { re: /starkbier|doppelbock|bock(?!wurst)/i,                                        abv: 0.075, label: "Starkbier"      },
  // Radler (Bier+Limo mix, ~2.5 vol%) must precede generic beer row — lower ABV.
  { re: /\bradler\b/i,                                                                  abv: 0.025, label: "Radler"         },
  // Cider (fermented apple, ~4–6 vol%) — separate from beer, similar ABV.
  { re: /\bcider\b/i,                                                                   abv: 0.045, label: "Cider"          },
  { re: /weizen|hefeweizen|wei[sß]bier/i,                                              abv: 0.04,  label: "Weizenbier"     },
  // stout, IPA, craft beer share the standard beer ABV band.
  { re: /bier|pils|lager|helles|beer|\bstout\b|\bipa\b|craft\s*beer/i,               abv: 0.04,  label: "Bier"           },
  { re: /sekt|prosecco|champagner|sparkling\s*wine/i,                                  abv: 0.10,  label: "Sekt"           },
  // Sangria (wine-based, ~9 vol%) before generic wine to get correct ABV.
  { re: /\bsangria\b/i,                                                                 abv: 0.09,  label: "Sangria"        },
  // Glühwein / mulled wine (~9 vol%) before generic wein to avoid Wein-row match.
  { re: /glühwein|gluehwein|mulled\s*wine/i,                                          abv: 0.09,  label: "Glühwein"       },
  // Federweißer (new wine, partially fermented, ~6 vol% average).
  { re: /federweiß|federweißer|federweisser|federweiser/i,                            abv: 0.06,  label: "Federweißer"    },
  { re: /rotwein|wei[sß]wein|ros[eé]|red\s*wine|white\s*wine|wine|wein/i,             abv: 0.10,  label: "Wein"           },
  { re: /aperol\s*spritz/i,                                                             abv: 0.06,  label: "Aperol Spritz"  },
  { re: /schnaps|vodka|wodka|gin\b|whiskey|whisky|rum\b|tequila|spirit|spirituos/i,   abv: 0.35,  label: "Spirits"        },
  { re: /baileys|lik[oö]r|liqueur/i,                                                   abv: 0.17,  label: "Likör"          },
  { re: /mojito|caipirinha/i,                                                           abv: 0.08,  label: "Cocktail"       },
  { re: /aperol|aperitif|digestif/i,                                                    abv: 0.11,  label: "Aperitif"       },
  // \bsake\b: word boundary prevents substring matches (e.g. no false positives on "forsake").
  { re: /\bsake\b/i,                                                                    abv: 0.12,  label: "Sake"           },
  { re: /cocktail/i,                                                                     abv: 0.08,  label: "Cocktail"       },
];

/**
 * Processes a list of raw items from Mistral's tool response and fills in
 * missing `alcohol_g` values for items whose names match alcohol keywords.
 *
 * Rules (in order):
 * 1. Non-alcoholic keyword in name → force alcohol_g = 0.
 * 2. Name matches alcohol keyword table:
 *    - If Mistral already set alcohol_g > 0 → keep Mistral's value.
 *    - Otherwise → estimate from abv × grams.
 * 3. Name does NOT match any alcohol keyword:
 *    - If Mistral set alcohol_g > 0 → REJECT (hallucination), override to 0.
 *    - Otherwise → no alcohol_g field.
 *
 * Rule 3 prevents Mistral from hallucinating alcohol on non-alcoholic items
 * like "Butter", "Joghurt", "Tomate" — the name must justify the value.
 */
export function applyAlcoholFallback(
  items: Array<{ name: string; grams: number; alcohol_g?: unknown }>,
): EnrichedRawItem[] {
  return items.map((item) => {
    const { name, grams } = item;
    const existing = typeof item.alcohol_g === "number" ? item.alcohol_g : null;
    const nameLower = name.toLowerCase();

    // ── 1. Exempt (non-alcoholic keyword) → always 0 ──────────────────────
    const isExempt = EXEMPT_KEYWORDS.some((kw) => nameLower.includes(kw));
    if (isExempt) {
      if (existing !== null && existing !== 0) {
        console.log(
          `[alcohol-fallback] force alcohol_g=0 for item='${name}' (non-alcoholic keyword)`,
        );
      }
      return { name, grams, alcohol_g: 0 };
    }

    // ── 2. Name matches alcohol keyword → accept or estimate ───────────────
    for (const { re, abv, label } of ALCOHOL_MATCH_TABLE) {
      if (re.test(name)) {
        if (existing !== null && existing > 0) {
          // Trust Mistral's value — name confirms it's alcoholic.
          return { name, grams, alcohol_g: existing };
        }
        const estimated = Math.round(grams * abv * 10) / 10;
        console.log(
          `[alcohol-fallback] auto-set alcohol_g=${estimated} for item='${name}' (${label}, ${(abv * 100).toFixed(1)}% ABW × ${grams}g)`,
        );
        return { name, grams, alcohol_g: estimated };
      }
    }

    // ── 3. No keyword match ────────────────────────────────────────────────
    if (existing !== null && existing > 0) {
      // Mistral set alcohol_g but the item name is not recognizably alcoholic.
      // Treat this as a hallucination and suppress it.
      console.warn(
        `[alcohol-fallback] rejected hallucinated alcohol_g=${existing} for item='${name}' (no keyword match)`,
      );
      return { name, grams, alcohol_g: 0 };
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

/**
 * Word-boundary-safe patterns for the influence-entry guard.
 *
 * These are deliberately SEPARATE from ALCOHOL_MATCH_TABLE to avoid false
 * positives when matching inside longer sentences. For example, the bare
 * `wein` from ALCOHOL_MATCH_TABLE would match "Schwein" (pork) — adding `\b`
 * word boundaries prevents that.  Similarly `rum` would match "Rumpsteak".
 *
 * Rules: word boundaries on all short/ambiguous tokens; multi-word patterns
 * (e.g. "Aperol Spritz", "red wine") keep their natural boundary via \s*.
 */
const ALCOHOL_INFLUENCE_PATTERNS: RegExp[] = [
  /\bstarkbier\b|\bdoppelbock\b|\bbock(?!wurst)\b/i,
  /\bweizenbier\b|\bhefeweizen\b|\bwei[sß]bier\b/i,
  /\bbier\b|\bpils\b|\blager\b|\bhelles\b|\bbeer\b/i,
  // stout, IPA, craft beer — English beer styles not covered by the German-first row above.
  /\bstout\b|\bipa\b|\bcraft\s*beer\b/i,
  /\bsekt\b|\bprosecco\b|\bchampagner\b|\bsparkling\s*wine\b/i,
  /\brotwein\b|\bwei[sß]wein\b|\bros[eé]\b|\bred\s*wine\b|\bwhite\s*wine\b|\bwein\b/i,
  /\baperiol?\s*spritz\b/i,
  /\bschnaps\b|\bvodka\b|\bwodka\b|\bgin\b|\bwhiskey\b|\bwhisky\b|\brum\b|\btequila\b|\bspirituos/i,
  /\bbaileys\b|\blik[oö]r\b|\bliqueur\b/i,
  /\bmojito\b|\bcaipirinha\b/i,
  /\baperolf?\b|\baperitif\b|\bdigestif\b/i,
  /\bsake\b/i,
  /\bcocktail\b/i,
  /\balkohol\b|\balcohol\b/i,
  /\bcider\b|\bradler\b/i,
  // Seasonal / occasion drinks.
  /\bsangria\b/i,
  /\bglühwein\b|\bgluehwein\b|\bmulled\s*wine\b/i,
  /\bfederweiß\b|\bfederweißer\b|\bfederweisser\b|\bfederweiser\b/i,
];

/**
 * Returns true when the given free-text string contains at least one alcohol
 * keyword (and is NOT overridden by an exempt keyword).
 *
 * Used as a server-side guard in the `log_influence_entry` executor to reject
 * Mistral hallucinations that call the tool for clearly non-alcoholic contexts
 * (e.g. "Empanadas mit 15g Alkohol").
 *
 * Uses ALCOHOL_INFLUENCE_PATTERNS (word-boundary-safe) instead of
 * ALCOHOL_MATCH_TABLE to avoid substring false positives like "Schwein"
 * matching "wein" or "Rumpsteak" matching "rum".
 *
 * Rules:
 * - If any EXEMPT_KEYWORD is found → return false (non-alcoholic, no match).
 * - If any ALCOHOL_INFLUENCE_PATTERNS regex matches → return true.
 * - Otherwise → return false.
 */
export function hasAlcoholKeyword(text: string): boolean {
  if (!text) return false;
  const isExempt = EXEMPT_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));
  if (isExempt) return false;
  return ALCOHOL_INFLUENCE_PATTERNS.some((re) => re.test(text));
}
