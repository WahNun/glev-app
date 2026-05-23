# Glev Engine — Algorithm Documentation

> **Audience:** Developers and agents modifying Engine-related code.  
> **Purpose:** Document every invariant, threshold, and decision branch so a change in one layer does not silently break clinical logic downstream.  
> **Last updated:** 2026-05-20

---

## Overview

The Glev Engine is a **personalised insulin decision-support pipeline** for adults with Type 1 Diabetes on ICT (pen injections). It takes a logged meal and returns:

1. A **per-meal outcome** (GOOD / UNDERDOSE / OVERDOSE / SPIKE / SPIKE_STRONG / HYPO_DURING / CHECK_CONTEXT)
2. A **personalised Adaptive ICR** (insulin-to-carb ratio, grams per unit) learned from the user's own history
3. A **dose recommendation** (carb dose + optional correction dose, with safety annotations)
4. A **pattern summary** (over the last 30 days / 20 meals)

All four layers are pure TypeScript functions with no side effects. Their inputs and outputs are described below.

---

## Step 1 · Meal Classification

**File:** `lib/meals.ts` → `classifyMeal(carbs, protein, fat, fiber, sugars?)`  
**Mirror:** `lib/ai/systemPrompt.ts` — the GPT prompt MUST match these rules exactly.

Rules are checked **in order — first match wins**:

| Priority | Class | Condition |
|----------|-------|-----------|
| 1 | **FAST_CARBS** | `carbs ≥ 45` **AND** (`sugars/carbs > 0.5` OR `fiber < 5g`) |
| 2 | **FAST_CARBS** | `carbs > 0` AND `fat < 3g` AND `protein < 3g` *(pure-sugar snack — fires for any carb amount, e.g. 11g gummies)* |
| 3 | **HIGH_FAT** | `(fat × 9) / total_kcal > 0.45` |
| 4 | **HIGH_PROTEIN** | `carbs < 5g` AND `fat < 5g` AND `protein > 0` *(pure-protein special case — whey shake, plain chicken)* |
| 5 | **HIGH_PROTEIN** | `protein > carbs` AND `protein > fat` AND `protein ≥ 20g` |
| 6 | **BALANCED** | fallback — no dominant macro |

**Invariants to preserve:**
- Rule 2 (pure-sugar snack) must stay above the macro tests. Without it, a 11g gummy-bear snack falls into BALANCED.
- Rule 4 (pure-protein) must stay above Rule 5. Without it, a whey shake (24P/0C/0F) falls into BALANCED because 24 < 25.
- The legacy `HIGH_FIBER` bucket was removed in Task #15. Any row with `meal_type = 'HIGH_FIBER'` in the database is historical and must not be reclassified.
- The GPT system prompt (`lib/ai/systemPrompt.ts`) mirrors these rules verbatim. If you change `classifyMeal`, update the prompt too.

---

## Step 2 · Meal Lifecycle

**File:** `lib/engine/lifecycle.ts` → `lifecycleFor(meal, now?, settings?)`

A meal moves through three states as post-meal readings arrive:

```
pending → provisional → final
```

| State | Condition |
|-------|-----------|
| `pending` | Age < 60 min, no post-meal BG yet |
| `provisional` | Has bg_1h but not bg_2h, OR bg reading is outside ±30 min window |
| `final` | Has bg_2h within ±30 min of meal time **OR** curve aggregates populated (`had_hypo_window / max_bg_180 / min_bg_180`) |

**Delta and speed calculations:**
- `delta1 = bg_1h − bg_before`
- `delta2 = bg_2h − bg_before`
- `speed1 = delta1 / 60` (mg/dL/min, first-hour slope)
- `speed2 = delta2 / 120` (mg/dL/min, two-hour slope)

**Curve-finality (Task #187):** When the `+3h` CGM backfill job has run and populated `had_hypo_window`, `max_bg_180`, or `min_bg_180`, the lifecycle treats the meal as **final** regardless of whether `bg_2h` landed inside the ±30 min window. The curve is ground truth. `HYPO_DURING` in particular must win even when `bg_2h` is back in range.

**BG column cascade (legacy compatibility):**
- `bg_1h` → falls back to `glucose_1h`
- `bg_2h` → falls back to `glucose_2h` → falls back to `glucose_after`

Only the Adaptive ICR and pattern detection consume `state === "final"` meals. The evaluator runs on all states but only final outcomes are trusted for learning.

---

## Step 3 · Per-Meal Evaluation

**File:** `lib/engine/evaluation.ts` → `evaluateEntry(input)`

Given a single meal with its post-meal readings, returns:
- `outcome`: one of `GOOD | UNDERDOSE | OVERDOSE | SPIKE | SPIKE_STRONG | HYPO_DURING | CHECK_CONTEXT`
- `confidence`: `high | medium | low`
- `delta`: BG change (mg/dL) or `null`
- `messages`: localizable reasoning tokens (never raw strings in the UI)

### 3a · Hypo detection (highest priority)

Fires **before** spike or delta checks. A meal is labelled `HYPO_DURING` when any of:
- `hadHypoWindow === true` (curve data confirms a sub-70 dip inside 0–180 min)
- `minBg180 < 70` (curve minimum below 70 mg/dL)
- `bgAfter < 70` (sparse post-meal point is itself below threshold)

Hypo threshold: **70 mg/dL** (constant `HYPO_THRESHOLD` in `lib/engine/evaluation.ts`).

Confidence: always `high` when triggered.

### 3b · Spike detection (second priority)

Implemented in the private `detectSpike()` function. Combines three signals:

**Spike cutoffs by meal class** (constants `SPIKE_CUTOFF_*` in `lib/engine/evaluation.ts`):

| Class | Spike cutoff | Constant |
|-------|-------------|----------|
| FAST_CARBS | 70 mg/dL | `SPIKE_CUTOFF_FAST_CARBS` |
| HIGH_PROTEIN | 50 mg/dL | `SPIKE_CUTOFF_HIGH_PROTEIN` |
| BALANCED | 55 mg/dL | `SPIKE_CUTOFF_BALANCED` |
| HIGH_FAT | 40 mg/dL | `SPIKE_CUTOFF_HIGH_FAT` |

**Trigger conditions (any one suffices):**
- `peakRise = maxBg180 − bgBefore > cutoff` *(curve peak)*
- `delta = bgAfter − bgBefore > cutoff` *(legacy 2h delta)*
- `speed1 ≥ 1.5 mg/dL/min` OR `speed2 ≥ 1.5 mg/dL/min` *(slope — `SPEED_SPIKE_MGDL_PER_MIN` in `lib/engine/evaluation.ts`)*

**Severity escalation to `SPIKE_STRONG`:**
- Magnitude: `peakRise > cutoff × 1.5` OR `delta > cutoff × 1.5` *(multiplier: `SPIKE_STRONG_MAGNITUDE_MULTIPLIER`)*
- Speed: `speed1 ≥ 2.5 mg/dL/min` OR `speed2 ≥ 2.5 mg/dL/min` *(constant: `SPEED_SPIKE_STRONG_MGDL_PER_MIN`)*

**Confidence:**
- `high` when magnitude signal (peak or delta) is present
- `medium` when speed-only trigger (no post-meal magnitude available)

**Why speed matters (Task #251 / Diagnose Case C):** A meal can produce a steep brief rise that decays back by the 2h measurement. Before speed detection was added, such meals showed `|Δ_2h| ≤ 30` and were labelled GOOD. Speed detection closes this gap.

### 3c · Delta-based outcome (third priority)

When post-meal BG is available and no spike/hypo fired:

| Condition | Outcome |
|-----------|---------|
| `delta > 30` | UNDERDOSE |
| `delta < -30` | OVERDOSE |
| `-30 ≤ delta ≤ 30` | GOOD |

Confidence: `high` when `|delta| > 80`, `medium` when `|delta| > 25`, `high` otherwise (the small-delta band is well-defined).

### 3d · ICR-ratio fallback (no post-meal BG)

When no `bgAfter` is available and insulin > 0:

```
expected = netCarbs / effectiveICR
if bgBefore > targetBG: expected += (bgBefore − targetBG) / CF
ratio = insulin / max(expected, 0.1)
```

| Ratio | Outcome |
|-------|---------|
| `> 1.35` | OVERDOSE |
| `< 0.65` | UNDERDOSE |
| `0.65 – 1.35` | GOOD |

Confidence is always `low` — no post-meal observation.

If `insulin ≤ 0` and no BG: returns `GOOD` with `confidence: low` and a neutral "no insulin / no data" message. The ratio path must not run when there is no insulin — it would mechanically yield UNDERDOSE.

**Per-time ICR (Phase B / Matildav):** When `mealTime` is supplied, `getEffectiveICR(mealTime, settings.icr)` is called. If the user has the ICR schedule master toggle ON and the meal falls inside a configured window, the window's ICR overrides `settings.icr` for the ratio calculation.

---

## Step 4 · Adaptive ICR

**File:** `lib/engine/adaptiveICR.ts` → `computeAdaptiveICR(meals, boluses?, schedule?)`

Learns the user's personal ICR from finalized meals using a **weighted average** of observed `carbs / insulin` ratios.

### Sample selection

Only meals with:
- `lifecycleFor(meal).state === "final"`
- `carbs_grams > 0`
- `insulin > 0` (from bolus pair or `meal.insulin_units`)

### Outcome weights

Poor outcomes contribute less — they likely reflect a mis-dosed meal rather than the user's true ICR.  
Source: `OUTCOME_WEIGHT` in `lib/engine/adaptiveICR.ts`.

| Outcome | Weight |
|---------|--------|
| GOOD | 1.0 |
| SPIKE | 0.7 |
| SPIKE_STRONG | 0.4 |
| UNDERDOSE | 0.3 |
| OVERDOSE | 0.3 |
| HYPO_DURING, CHECK_CONTEXT | 0 (skipped) |

### Bolus pairing

Insulin values are resolved in priority order:

1. **Explicit tag:** bolus logs with `related_entry_id` pointing to the meal. All explicitly tagged boluses for the same meal are **summed** (covers split-bolus / pre-bolus + correction).
2. **Time-window heuristic:** untagged boluses within ±30 min of the meal (1:1, first match). Less certain than explicit tags.
3. **Legacy fallback:** `meal.insulin_units` — used when no bolus pair is found.

Basal logs are always filtered out and never contribute to ICR.

### Time-of-day buckets

| Bucket | Hours |
|--------|-------|
| morning | 00:00 – 10:59 |
| afternoon | 11:00 – 16:59 |
| evening | 17:00 – 23:59 |

Bucket ICR is only emitted when **≥ 3 samples** (`MIN_BUCKET_SAMPLES` in `lib/engine/adaptiveICR.ts`) exist in that bucket. Global ICR is always computed from all samples.

### Per-schedule-window ICR (Phase B3)

When the user has configured an ICR schedule with the master toggle ON, `computeAdaptiveICR` also fills per-slot buckets aligned to the schedule's time windows. Each slot requires **≥ 3 samples** before a `learnedIcr` is emitted.

### Output: `AdaptiveICR`

```typescript
{
  global: number | null,
  morning: number | null,
  afternoon: number | null,
  evening: number | null,
  sampleSize: number,          // total qualifying meals
  pairedCount: number,         // meals where insulin came from a bolus pair
  pairedExplicitCount: number, // subset: explicit related_entry_id
  pairedTimeWindowCount: number, // subset: ±30 min heuristic
  windows: WindowAdaptiveICR[], // per-schedule-slot results
}
```

---

## Step 5 · Dose Recommendation

**File:** `lib/engine/recommendation.ts` → `recommendDose(input)`

### ICR selection (priority order)

1. Time-of-day slot (`morning | afternoon | evening`) if `sampleSize ≥ 1` for that slot
2. `global` ICR if available
3. Hardcoded default: **15 g/u** (`DEFAULT_ICR` in `lib/engine/constants.ts`)

### Dose formula

```
carbDose       = carbs / icrUsed
correctionDose = (currentBG − targetBG) / CF   [only when BG > targetBG]
total          = carbDose + correctionDose
recommendedUnits = round(total × 2) / 2        [rounded to 0.5u]
```

**Defaults when user settings are unavailable** (constants in `lib/engine/constants.ts`):
- ICR: 15 g/u (`DEFAULT_ICR`)
- CF (correction factor): 50 mg/dL per unit (`DEFAULT_CF`)
- Target BG: 110 mg/dL (`DEFAULT_TARGET_BG`)

### Safety gates (hard limits — never bypass)

Constants in `lib/engine/recommendation.ts`: `SAFETY_BG_MIN`, `MAX_DOSE_UNITS`.

| Gate | Condition | Constant | Effect |
|------|-----------|----------|--------|
| BG floor | `currentBG < 80 mg/dL` | `SAFETY_BG_MIN` | `blocked = true`, dose = 0, confidence = high |
| Dose ceiling | `total > 25 units` | `MAX_DOSE_UNITS` | Clamp to 25u, add `engine_rec_clamped` message |

When `blocked = true`, no dose number is shown to the user. This is a clinical safety invariant — do not relax the floor or ceiling without explicit sign-off from the medical responsibility team (see D-003).

### Confidence bands

| Condition | Confidence |
|-----------|------------|
| ICR source = "default" (no personal data) | low |
| `sampleSize ≥ 10` | high |
| `sampleSize ≥ 5` | medium |
| `sampleSize < 5` | low |

Confidence is displayed to the user as TUNED / LEARNING / WARMING UP in the UI. It does **not** suppress the recommendation — it only sets user expectations.

---

## Safety Annotations (non-dose-altering)

The following signals are appended as **informational messages only**. The calculated dose number is never changed by them. This is a compliance requirement (D-003): no dose decision may flow from passive contextual signals.

| Signal | Trigger | Message key |
|--------|---------|-------------|
| Pre-meal CGM trend | `preTrend` set (rising_fast / rising / stable / falling / falling_fast) | `engine_rec_trend_<trend>` |
| Trend overshoot warning | `preTrend = rising_fast` AND `currentBG − targetBG ≤ 40` | `engine_rec_trend_overshoot_warn` |
| Bolus stacking | > 2 bolus logs in last **6 hours** | `engine_rec_stacking` |
| Basal context | Any basal log in last **24 hours** | `engine_rec_basal` |
| Recent exercise | Any exercise log in last **4 hours** | `engine_rec_exercise` |
| High activity day | `todaySteps ≥ avgSteps7d × 1.3` AND `todaySteps ≥ 8000` AND `sampleSize7d ≥ 3` | `engine_rec_high_activity` |

The `isHighActivityDay()` predicate is exported from `evaluation.ts` and shared by the evaluator, recommender, and Insights cards so all surfaces use identical thresholds.

---

## Pattern Detection

**File:** `lib/engine/patterns.ts` → `detectPattern(meals, now?)`

Summarises the user's recent dosing history as a single pattern label.

### Window

- Up to **20 most recent** finalized meals
- Within **last 30 days**

### Time-decay weighting

```
ageRatio = min(1, ageMs / 30d)
w = 1 − 0.5 × ageRatio    [ranges from 1.0 (now) to 0.5 (30d ago)]
```

Older meals carry half the weight of today's meals, so recent behaviour dominates.

### Pattern thresholds

| Weighted rate | Pattern |
|---------------|---------|
| `overdoseRate > 0.50` | `overdosing` |
| `underdoseRate > 0.50` | `underdosing` |
| `spikeRate > 0.40` | `spiking` |
| Otherwise | `balanced` |
| `n < 5` | `insufficient_data` |

Both `SPIKE` and `SPIKE_STRONG` are counted in the same `spike` bucket for pattern purposes.

### Confidence

| Sample count | Confidence |
|-------------|------------|
| `n ≥ 15` | high |
| `n ≥ 10` | medium |
| `n < 10` | low |

### Curve-aware enrichment (Task #187 / #194)

When at least one meal in the window has curve aggregates (`max_bg_180 ≠ null`), a `curveInsights` object is attached alongside the outcome counts:

| Metric | Definition |
|--------|-----------|
| `hypoRate` | Share of meals with `had_hypo_window === true` |
| `fastSpikeRate` | Share with `time_to_peak_min < 45` |
| `lateDipRate` | Share with `min_bg_60_180 < 80` |
| `avgTimeToPeak` | Mean minutes to glucose peak |
| `avgAuc` | Mean AUC over 0–180 min (mg/dL · min) |

---

## Invariants to Preserve

The following must hold after any change to Engine code. Violations may produce incorrect clinical outputs without raising a TypeScript error.

1. **Hypo wins over spike.** `HYPO_DURING` detection runs first in `evaluateEntry`. A meal with a mid-window hypo must never be classified as SPIKE or GOOD.
2. **Speed-only spikes must propagate.** A meal with `speed1 ≥ 1.5 mg/dL/min` must produce SPIKE even when `|Δ_2h| ≤ 30`. Do not remove the speed trigger from `detectSpike`.
3. **BG < 80 → blocked.** `recommendDose` must return `blocked: true` and `recommendedUnits: 0` when `currentBG < 80`. No code path may bypass this.
4. **Max dose 25u.** Never raise `MAX_DOSE_UNITS` without explicit sign-off.
5. **No dose mutation from annotations.** The safety annotation block (preTrend, stacking, exercise, activity) appends messages only. The `total` variable must not change after those blocks.
6. **classifyMeal and systemPrompt must agree.** When editing classification rules, update both `lib/meals.ts` and `lib/ai/systemPrompt.ts`. A mismatch causes GPT to return a class that the evaluator would never assign, breaking spike cutoff selection.
7. **Outcome weights ≠ 0 required to feed ICR.** Only outcomes with a positive weight in `OUTCOME_WEIGHT` contribute to the adaptive ICR. Adding a new outcome type requires a deliberate weight assignment.
8. **`sampleSize` threshold for time-of-day ICR is `MIN_BUCKET_SAMPLES` (3).** Lowering this risks noisy buckets driving recommendations. Raising it silently degrades personalisation for users with sparse logs.
9. **Pump users excluded from dose recommendation.** The Engine page must display a disclaimer or suppress the recommendation number for pump users (D-005). Do not remove that gate.

---

## Related Files

| File | Role |
|------|------|
| `lib/meals.ts` | `classifyMeal` + `Meal` type |
| `lib/engine/evaluation.ts` | Per-meal outcome, spike, hypo, ICR-ratio |
| `lib/engine/lifecycle.ts` | State machine: pending → provisional → final |
| `lib/engine/recommendation.ts` | Dose formula, safety gates, annotations |
| `lib/engine/adaptiveICR.ts` | Weighted ICR learning from history |
| `lib/engine/patterns.ts` | 30-day pattern summary |
| `lib/engine/pairing.ts` | Bolus ↔ meal matching |
| `lib/engine/adjustment.ts` | `AdjustmentMessage` type shared across engine |
| `lib/icrSchedule.ts` | Per-time ICR schedule (`getEffectiveICR`) |
| `lib/ai/systemPrompt.ts` | GPT prompt — must mirror `classifyMeal` rules |
| `tests/unit/evaluation.test.ts` | Outcome / spike / hypo unit tests |
| `tests/unit/recommendation.test.ts` | Dose formula unit tests |
| `tests/unit/adaptiveICR.test.ts` | ICR learning unit tests |
| `tests/unit/classifyMeal.test.ts` | Classification boundary tests |

---

## Threshold Index

> **This table is machine-read by `scripts/check-engine-doc-thresholds.mjs`.**  
> Run `pnpm run check:engine-doc` to verify every value here matches its source constant.  
> **When you change a constant in the source, update this table and re-run the check.**

| Constant | Source file | Value |
|----------|-------------|-------|
| HYPO_THRESHOLD | lib/engine/evaluation.ts | 70 |
| SPEED_SPIKE_MGDL_PER_MIN | lib/engine/evaluation.ts | 1.5 |
| SPEED_SPIKE_STRONG_MGDL_PER_MIN | lib/engine/evaluation.ts | 2.5 |
| SPIKE_STRONG_MAGNITUDE_MULTIPLIER | lib/engine/evaluation.ts | 1.5 |
| SPIKE_CUTOFF_FAST_CARBS | lib/engine/evaluation.ts | 70 |
| SPIKE_CUTOFF_HIGH_FAT | lib/engine/evaluation.ts | 40 |
| SPIKE_CUTOFF_HIGH_PROTEIN | lib/engine/evaluation.ts | 50 |
| SPIKE_CUTOFF_BALANCED | lib/engine/evaluation.ts | 55 |
| DEFAULT_ICR | lib/engine/constants.ts | 15 |
| DEFAULT_CF | lib/engine/constants.ts | 50 |
| DEFAULT_TARGET_BG | lib/engine/constants.ts | 110 |
| SAFETY_BG_MIN | lib/engine/recommendation.ts | 80 |
| MAX_DOSE_UNITS | lib/engine/recommendation.ts | 25 |
| MIN_BUCKET_SAMPLES | lib/engine/adaptiveICR.ts | 3 |
