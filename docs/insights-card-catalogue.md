# Insights Card Catalogue

Generated 2026-06-18. Source: `app/(protected)/insights/page.tsx` + `types/InsightsCluster.ts`.

## Cluster: Glukose (`requiresTier: "pro"`)
Individual cards gated via `UpgradeGate` per-card (no cluster-level lock).

| Card ID | UpgradeGate Feature | Feature Tier | Description |
|---|---|---|---|
| `time-in-range` | `tir_analysis` | pro | TIR / TBR / TAR 3-band bar + delta vs prev week |
| `gmi-a1c` | `hba1c_gmi` | pro | GMI glucose management indicator + avg BG |
| `glucose-trend` | `trends_variability` | pro | 7-day BG trend sparkline + period delta |
| `hypo-events` | `tir_analysis` | pro | Hypoglycemia event clustering + count |
| `hyper-events` | `tir_analysis` | pro | Hyperglycemia event count |
| `glucose-variability` | `trends_variability` | pro | CV% stability analysis |

## Cluster: Muster (`requiresTier: "pro"`)
Individual cards gated via `UpgradeGate` per-card (no cluster-level lock).

| Card ID | UpgradeGate Feature | Feature Tier | Description |
|---|---|---|---|
| `meal-evaluation` | `meal_bz_rating` | pro | Meal outcome distribution (Good / Spike / Hypo) |
| `post-bolus-trend` | *(none)* | — | Post-bolus BG trajectory from meal checks |
| `adaptive-engine` | `adaptive_icr` | pro | Learned ICR per meal-time + bolus suggestions |
| `tdd` | *(none)* | — | Total daily insulin (bolus + basal) |
| `patterns` | `bz_pattern_recognition` | pro | Under/over-dosing pattern detection |
| `meal-type` | `meal_type_breakdown` | pro | BG outcome breakdown by meal type |
| `time-of-day` | *(none)* | — | Meal distribution across day (morning/noon/evening/night) |
| `performance-tiles` | *(none)* | — | Derived KPIs: avg glucose, carbs, insulin, ICR |

## Cluster: Workout (`requiresTier: "plus"`)
**Cluster-level lock** for non-Plus users (cluster blur + lock overlay + Glev+ CTA).
Cards have no individual `UpgradeGate`.

| Card ID | Description |
|---|---|
| `workout-outcomes` | Exercise effect distribution (BG drop / neutral / rise) |
| `workout-bg-response` | BG delta by exercise type |
| `workout-patterns` | Detected workout patterns (e.g. consistent afternoon drop) |
| `workout-type-patterns` | Per-exercise-type stats (run / cycle / strength / etc.) |
| `daily-steps` | Apple Health step count integration |
| `active-day-outcomes` | Activity impact on post-meal BG outcomes |

## Cluster: Schlaf & Zyklus (`requiresTier: "all"`)
No gate — visible to all plans.

| Card ID | Description |
|---|---|
| `cycle-symptoms` | Menstrual cycle phases + symptom tracking (hidden for male users) |

## Notes

- `post-bolus-trend`, `tdd`, `time-of-day`, `performance-tiles` have no `UpgradeGate` → visible to all logged-in users (data may be sparse for free users without CGM).
- `cycle-symptoms` renders `null` for male users (from `profiles.biological_sex`) and when no data exists.
- `daily-steps` renders `null` when Apple Health step data is absent or < 14 days.
- `active-day-outcomes` renders `null` when < 14 step-tracked days AND < 3 classified meals per activity category.
- The workout cluster lock uses `canAccess("insights_workout_cluster", plan, trialActive)` — defined in `lib/planFeatures.ts` as tier "plus". Trial (pro-level) does NOT unlock Plus.
