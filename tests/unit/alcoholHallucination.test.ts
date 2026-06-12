// tests/unit/alcoholHallucination.test.ts
//
// Regression-Tests für Alkohol-Halluzination in Mahlzeit-Einträgen.
//
// Problem: gpt-4o-mini setzt alcohol_g > 0 bei nicht-alkoholischen Items
// (z. B. "Pizza", "Hähnchen", "Weintrauben"). Zweischichtiger Schutz:
//
//   Schicht 1 — ALCOHOL_MATCH_TABLE hat \b-Wortgrenzen: "Weintrauben" passt
//               nicht auf /\bwein\b/, "Lagerstärke" nicht auf /\blager\b/ usw.
//               → verhindert Auto-Setzung von alcohol_g für Lebensmittel.
//
//   Schicht 2 — applyAlcoholFallback (Rule 3): wenn das Modell trotzdem
//               alcohol_g > 0 setzt, aber kein Keyword passt → Wert auf 0 setzen.

import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(process.cwd(), "lib/ai/alcoholFallback.ts"),
  "utf-8",
);

// ── Hilfsfunktion: ALCOHOL_MATCH_TABLE aus dem Source-Code extrahieren ─────────
// Wir bauen die Table direkt nach (kein import möglich in Playwright unit tests)
// und vergleichen damit das Verhalten der echten Datei.

// Extrahiere alle RegExp-Literale aus der ALCOHOL_MATCH_TABLE im Source.
function extractTableRegexes(src: string): RegExp[] {
  const tableBlock = src.match(/ALCOHOL_MATCH_TABLE.*?\];/s)?.[0] ?? "";
  const regexes: RegExp[] = [];
  for (const m of tableBlock.matchAll(/\{ re: (\/[^,]+\/[gi]*)/g)) {
    try {
      regexes.push(eval(m[1]) as RegExp);
    } catch {
      /* skip malformed */
    }
  }
  return regexes;
}

const TABLE_REGEXES = extractTableRegexes(SRC);

function matchesTable(word: string): boolean {
  return TABLE_REGEXES.some((re) => re.test(word));
}

// ── 1. ALCOHOL_MATCH_TABLE: keine False-Positives auf Lebensmittel ─────────────

const FOOD_ITEMS_THAT_MUST_NOT_MATCH = [
  // Trauben / Frucht — wichtigster Regression-Fall: "Weintrauben" darf nicht
  // auf /\bwein\b/ matchen (Wortgrenze nach "Wein" ist nicht vorhanden).
  "Weintrauben",
  "Traubensaft",
  // Süßigkeiten
  "Weingummi",
  // Soßen aus der Packung (kein echter Alkohol)
  "Weinsauce",
  // Stärke-Produkte ("lager" in "Lagerstärke" hat keine rechte Wortgrenze)
  "Lagerstärke",
  // Käse- und Brot-Varianten ("bier" in "Bierkäse" hat keine rechte Wortgrenze)
  "Bierkäse",
  "Schwarzbrot",
  "Spirelli",
  "Rumpsteak",
  // Klassische Nicht-Alkohol-Mahlzeiten
  "Pizza Margherita",
  "Pizza",
  "Hähnchenbrust",
  "Hähnchen",
  "Joghurt",
  "Apfelsaft",
  "Ingwer",
  "Glasnudeln",
  "Sauerkraut",
  "Empanadas",
  "Weißkohl",
  // Hinweis: "Pils-Linsen" ist ein akzeptierter Randfall — der Bindestrich
  // erzeugt eine Wortgrenze, sodass /\bpils\b/ matcht. In der Praxis gibt
  // es kaum Mahlzeiten die "Pils-" als Präfix haben; Rule-3-Guard in
  // applyAlcoholFallback fängt den Fall ab, wenn das Modell keinen Alkohol setzt.
];

for (const food of FOOD_ITEMS_THAT_MUST_NOT_MATCH) {
  test(`ALCOHOL_MATCH_TABLE: "${food}" wird NICHT als alkoholisch erkannt`, () => {
    expect(matchesTable(food)).toBe(false);
  });
}

// ── 2. ALCOHOL_MATCH_TABLE: echte Alkohol-Drinks werden korrekt erkannt ────────

const ALCOHOLIC_DRINKS_THAT_MUST_MATCH = [
  "Bier",
  "Pils",
  "Lager",
  "Weizen",
  "Hefeweizen",
  "Rotwein",
  "Weißwein",
  "Wein",
  "Sekt",
  "Prosecco",
  "Champagner",
  "Schnaps",
  "Vodka",
  "Wodka",
  "Gin",
  "Whiskey",
  "Rum",
  "Tequila",
  "Cocktail",
  "Mojito",
  "Caipirinha",
  "Aperol Spritz",
  "Radler",
  "Cider",
  "Sangria",
  "Glühwein",
  "Sake",
  "Starkbier",
  "Doppelbock",
  "Federweißer",
];

for (const drink of ALCOHOLIC_DRINKS_THAT_MUST_MATCH) {
  test(`ALCOHOL_MATCH_TABLE: "${drink}" wird als alkoholisch erkannt`, () => {
    expect(matchesTable(drink)).toBe(true);
  });
}

// ── 3. Schicht-2-Guard: Rule 3 in applyAlcoholFallback ist vorhanden ───────────

test("alcoholFallback.ts: Rule-3-Guard (hallucination suppression) ist dokumentiert", () => {
  // Rule 3 muss explizit im Quellcode vorhanden sein
  expect(SRC).toContain("no keyword match");
  expect(SRC).toContain("hallucination");
  expect(SRC).toContain("alcohol_g: 0");
});

test("alcoholFallback.ts: EXEMPT_KEYWORDS decken non-alcoholic Varianten ab", () => {
  expect(SRC).toContain("alkoholfrei");
  expect(SRC).toContain("non-alcoholic");
  expect(SRC).toContain("alcohol-free");
  expect(SRC).toContain("0,0%");
});

// ── 4. Tool-Beschreibung: explizite Negativbeispiele enthalten ─────────────────

test("glevTools.ts: alcohol_g-Beschreibung nennt Lebensmittel-Negativbeispiele", () => {
  const toolsSrc = readFileSync(
    join(process.cwd(), "lib/ai/glevTools.ts"),
    "utf-8",
  );
  // Muss mindestens eines der bekannten Lebensmittel-Gegenbeispiele nennen
  const mentionsFoodExamples =
    toolsSrc.includes("Weintrauben") ||
    toolsSrc.includes("Weingummi") ||
    toolsSrc.includes("Bierkäse");
  expect(mentionsFoodExamples).toBe(true);
});

test("glevTools.ts: alcohol_g-Beschreibung enthält NIEMALS/AUSSCHLIESSLICH", () => {
  const toolsSrc = readFileSync(
    join(process.cwd(), "lib/ai/glevTools.ts"),
    "utf-8",
  );
  const hasStrongNegation =
    toolsSrc.includes("NIEMALS") || toolsSrc.includes("AUSSCHLIESSLICH");
  expect(hasStrongNegation).toBe(true);
});

// ── 5. Wortgrenzen im Source-Code vorhanden ────────────────────────────────────

test("alcoholFallback.ts: ALCOHOL_MATCH_TABLE enthält \\bwein\\b (Wortgrenze)", () => {
  expect(SRC).toContain("\\bwein\\b");
});

test("alcoholFallback.ts: ALCOHOL_MATCH_TABLE enthält \\bwine\\b (Wortgrenze)", () => {
  expect(SRC).toContain("\\bwine\\b");
});

test("alcoholFallback.ts: ALCOHOL_MATCH_TABLE enthält \\bbier\\b (Wortgrenze)", () => {
  expect(SRC).toContain("\\bbier\\b");
});

test("alcoholFallback.ts: ALCOHOL_MATCH_TABLE enthält \\blager\\b (Wortgrenze)", () => {
  expect(SRC).toContain("\\blager\\b");
});
