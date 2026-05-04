// Unit coverage for `classifyMeal` in `lib/meals.ts` — the deterministic
// meal-type classifier shared between the GPT prompt
// (`lib/ai/systemPrompt.ts`) and the local fallback path.
//
// Why this exists:
//   The classifier owns four mutually-exclusive buckets (FAST_CARBS,
//   HIGH_FAT, HIGH_PROTEIN, BALANCED), checked in a strict order. The
//   FAST_CARBS rule in particular is easy to silently regress because
//   it depends on TWO independent sub-conditions joined by OR
//   (`sugars/carbs > 0.5` OR `fiber < 5`), gated by a hard carbs ≥ 45g
//   floor. Task #41 pins each rule, the precedence ordering, and a
//   handful of boundary cases on the FAST_CARBS sugars/fiber threshold.

import { test, expect } from "@playwright/test";

import { classifyMeal } from "@/lib/meals";

/* ──────────────────────────────────────────────────────────────────
   FAST_CARBS — `carbs >= 45 && (sugarShare > 0.5 || fiber < 5)`.
   Checked first; wins over HIGH_FAT / HIGH_PROTEIN / BALANCED.
   ────────────────────────────────────────────────────────────────── */

test("classifyMeal: FAST_CARBS via low fiber (no sugars provided)", () => {
  // 60g carbs, only 2g fiber → fiber<5 branch fires.
  expect(classifyMeal(60, 5, 5, 2)).toBe("FAST_CARBS");
});

test("classifyMeal: FAST_CARBS via sugar share even with high fiber", () => {
  // 50g carbs, 10g fiber (fiber>=5), 26g sugar → sugarShare 0.52 > 0.5.
  // Verifies the OR branch actually fires when fiber is comfortably high.
  expect(classifyMeal(50, 5, 5, 10, 26)).toBe("FAST_CARBS");
});

test("classifyMeal: FAST_CARBS wins over HIGH_FAT when both rules match", () => {
  // 60g carbs (low fiber → FAST_CARBS) AND fat-dominant kcal mix
  // (60c+5p = 260kcal carb/protein vs 30g fat = 270kcal → fat share
  // > 0.45). Order matters: FAST_CARBS is checked first.
  expect(classifyMeal(60, 5, 30, 2)).toBe("FAST_CARBS");
});

/* ──────────────────────────────────────────────────────────────────
   FAST_CARBS edge cases on the sugars / fiber thresholds.
   ────────────────────────────────────────────────────────────────── */

test("classifyMeal: sugarShare exactly 0.5 → NOT FAST_CARBS (strict greater-than)", () => {
  // 50g carbs, 10g fiber (fiber>=5), 25g sugar → sugarShare = 0.5,
  // which is NOT > 0.5. Both FAST_CARBS sub-conditions fail → falls
  // through to the macro tests (BALANCED here).
  expect(classifyMeal(50, 5, 5, 10, 25)).toBe("BALANCED");
});

test("classifyMeal: fiber exactly 5g → NOT FAST_CARBS (strict less-than)", () => {
  // 60g carbs, 5g fiber, no sugars → fiber<5 is false, sugarShare null.
  // Both branches fail → BALANCED.
  expect(classifyMeal(60, 5, 5, 5)).toBe("BALANCED");
});

test("classifyMeal: carbs exactly 45g + low fiber → FAST_CARBS (boundary inclusive)", () => {
  // 45g carbs is the inclusive lower bound (`carbs >= 45`).
  expect(classifyMeal(45, 5, 5, 2)).toBe("FAST_CARBS");
});

test("classifyMeal: carbs 44g + low fiber → NOT FAST_CARBS (under the floor)", () => {
  expect(classifyMeal(44, 5, 5, 2)).toBe("BALANCED");
});

test("classifyMeal: zero carbs with sugars=0 → sugarShare null, never FAST_CARBS", () => {
  // sugars/carbs would divide by zero; the helper short-circuits to
  // null when carbs is 0, so the FAST_CARBS test is skipped entirely
  // regardless of the sugar number. Carbs < 5 AND fat < 5 with protein
  // present now fires the HIGH_PROTEIN "pure protein" rule (introduced
  // 2026-05-04 to fix the whey-shake misclassification bug).
  expect(classifyMeal(0, 10, 1, 0, 0)).toBe("HIGH_PROTEIN");
});

/* ──────────────────────────────────────────────────────────────────
   HIGH_FAT — `fat_kcal / total_kcal > 0.45`.
   Checked AFTER FAST_CARBS, BEFORE HIGH_PROTEIN.
   ────────────────────────────────────────────────────────────────── */

test("classifyMeal: HIGH_FAT when fat dominates the kcal mix", () => {
  // 30g carbs(120) + 10g protein(40) + 30g fat(270) = 430 kcal total.
  // Fat share = 270 / 430 ≈ 0.628 > 0.45 → HIGH_FAT.
  // (Carbs <45 keeps FAST_CARBS from firing.)
  expect(classifyMeal(30, 10, 30, 5)).toBe("HIGH_FAT");
});

test("classifyMeal: HIGH_FAT wins over HIGH_PROTEIN when both could apply", () => {
  // 10g carbs(40) + 30g protein(120) + 25g fat(225) = 385 kcal total.
  // Fat share = 225 / 385 ≈ 0.584 > 0.45 → HIGH_FAT.
  // Note protein > carbs && protein > fat-grams && protein >= 25 — those
  // would also satisfy HIGH_PROTEIN, so this pins the precedence.
  expect(classifyMeal(10, 30, 25, 5)).toBe("HIGH_FAT");
});

/* ──────────────────────────────────────────────────────────────────
   HIGH_PROTEIN — `protein > carbs && protein > fat && protein >= 25`.
   ────────────────────────────────────────────────────────────────── */

test("classifyMeal: HIGH_PROTEIN when protein dominates and >= 20g", () => {
  // 20c(80) + 30p(120) + 5f(45) = 245 kcal. fat share 45/245 ≈ 0.18
  // → not HIGH_FAT. protein(30) > carbs(20), protein > fat(5),
  // protein >= 20 → HIGH_PROTEIN.
  expect(classifyMeal(20, 30, 5, 3)).toBe("HIGH_PROTEIN");
});

test("classifyMeal: pure-protein item → HIGH_PROTEIN regardless of grams (whey shake fix)", () => {
  // 0c + 24p + 0f + 0fb → der echte User-Bug von 2026-05-04: ein
  // 300g Proteinshake mit nur 24g Protein wurde als BALANCED (vor
  // dem AI-Override) bzw. HIGH_FAT (mit AI-Override) klassifiziert.
  // Neue (a)-Regel "carbs<5 && fat<5 && protein>0" deckt das ab,
  // unabhängig davon dass 24g unter der "≥20g"-Schwelle liegt.
  expect(classifyMeal(0, 24, 0, 0)).toBe("HIGH_PROTEIN");
  // Auch ein winziger 5g-Protein-Shot zählt — wenn nichts anderes
  // drin ist, IST es ein Protein-Item.
  expect(classifyMeal(0, 5, 0, 0)).toBe("HIGH_PROTEIN");
  // Plain Hähnchenbrust (35g Protein, 0c, 3f) — pure-protein-Regel
  // fängt das auch wenn der dominante-Macro-Pfad ebenfalls greifen
  // würde. 3g Fett ist unter der 5g-Schwelle.
  expect(classifyMeal(0, 35, 3, 0)).toBe("HIGH_PROTEIN");
});

test("classifyMeal: low-protein item < 20g but mixed → BALANCED (pure-protein rule needs near-zero carbs+fat)", () => {
  // 10c + 18p + 5f → protein dominates aber nur 18g (<20). Carbs
  // (10) >= 5, also greift auch die pure-protein-Regel nicht.
  // → BALANCED. Schützt davor, dass jeder fett-arme Snack als
  // HIGH_PROTEIN durchgeht.
  expect(classifyMeal(10, 18, 5, 2)).toBe("BALANCED");
});

test("classifyMeal: protein equal to carbs → not HIGH_PROTEIN via dominance rule", () => {
  // 25c + 25p + 5f → protein is NOT > carbs. carbs (25) >= 5 also
  // greift die pure-protein-Regel nicht. → BALANCED.
  expect(classifyMeal(25, 25, 5, 3)).toBe("BALANCED");
});

/* ──────────────────────────────────────────────────────────────────
   BALANCED — fall-through bucket.
   ────────────────────────────────────────────────────────────────── */

test("classifyMeal: BALANCED when no dominant macro and not a fast-carb load", () => {
  // 30c + 10p + 5f → fat share 45/205 ≈ 0.22, protein 10<25 — none
  // of the three rules match.
  expect(classifyMeal(30, 10, 5, 3)).toBe("BALANCED");
});

test("classifyMeal: high-fiber high-carb meal → BALANCED (legacy HIGH_FIBER bucket removed)", () => {
  // 60g carbs but 12g fiber → fiber>=5; no sugars → sugarShare null.
  // Spec: HIGH_FIBER bucket was removed in Task #15, so this lands
  // in BALANCED rather than its own bucket.
  expect(classifyMeal(60, 5, 5, 12)).toBe("BALANCED");
});

test("classifyMeal: zero macros across the board → BALANCED (no division by zero)", () => {
  // totalKcal = 0 → HIGH_FAT branch is gated by `totalKcal > 0`.
  expect(classifyMeal(0, 0, 0, 0)).toBe("BALANCED");
});
