# Glev-AI READ-Tools Audit — 2026-06-21

Sprint: feat/ai-read-tools-dashboard-insights

## Goal

Identify the authoritative data sources for Settings macro targets, Dashboard cards, and Insights cluster values so that 5 new READ tools can be implemented for the Glev AI chat assistant.

---

## Phase 1 Findings

### 1. Macro Targets (`get_macro_targets`)

**Source table:** `user_settings` (one row per user, RLS scoped)

| Column | Semantics |
|---|---|
| `target_carbs_g` | Daily carb goal (g) |
| `target_protein_g` | Daily protein goal (g) |
| `target_fat_g` | Daily fat goal (g) |
| `target_fiber_g` | Daily fiber goal (g) |
| `target_bg_mgdl` | BZ point target (mg/dL) |
| `target_min_mgdl` | TIR lower bound (mg/dL) |
| `target_max_mgdl` | TIR upper bound (mg/dL) |

**Null semantics:** `NULL` = user never set this goal. AI must not assume 0, but tell the user to configure the goal in Settings → Makroziele.

---

### 2. Today's Macros (`get_today_macros_so_far`)

**Source table:** `meals` (RLS scoped)

- Query window: last 24 h from now (to ensure cross-midnight safety)
- Filter: `meal_time ?? created_at` in user's local timezone matches today's date
- Aggregated columns: `carbs_grams`, `protein_grams`, `fat_grams`, `fiber_grams`
- Timezone resolution: user's `timezone` field in `user_settings`; fallback `Europe/Berlin`

---

### 3. Dashboard Summary (`get_dashboard_summary`)

**Dashboard cards:** `app/(protected)/dashboard/page.tsx`

| Card | Data source |
|---|---|
| Current glucose + trend | `getHistory(userId)` → LibreLinkUp / Nightscout / Apple Health |
| IOB | `buildDoses()` + `calcTotalIOB()` from `lib/iob.ts`; uses `insulin_logs` (6h) + `meals` (for carb absorption) |
| TIR 7d | CGM history samples ≥ 7d ago, filtered to `[target_min_mgdl, target_max_mgdl]`; fallback: `glucose_before` from meals |
| Adapt Score 7d | `computeControlScore()` from `lib/controlScore.ts`; formula: `goodRate×0.7 + (100−spikeRate−hypoRate)×0.3` |
| Today's macros | `meals` filtered to today in local tz |
| Last meal | First row of `meals` ordered by `created_at DESC` |

---

### 4. Insights Summary (`get_insights_summary`)

**Clusters and sources:**

| Cluster key | UI label | Metrics | Source |
|---|---|---|---|
| `glucose_basics` | Glukose-Überblick | TIR, TBR, TAR, avg BG, GMI | CGM history (`getHistory`) |
| `meals_bolus` | Mahlzeiten & Bolus | Adapt Score, good/spike/hypo counts, meal type distribution | `meals` + `computeControlScore()` |
| `adaptive_engine` | Adaptiver Rechner | Bolus/Basal totals, ICR user vs engine | `insulin_logs` + `user_settings` |

**GMI formula (Bergenstal 2018):** `GMI% = 3.31 + 0.02392 × avgBG_mgdl`

**Scope:** `day` (24h) / `week` (7d, default) / `month` (30d)

---

### 5. Pattern Alerts (`get_pattern_alerts`)

**Source:** `detectPattern()` from `lib/engine/patterns.ts`

- Window: last 30 days, up to 20 final-state meals
- Pattern types: `overdosing | underdosing | spiking | balanced | insufficient_data`
- Requires at least 5 final-state meals to return a non-insufficient_data result
- CurveInsights enrichment available when `max_bg_180 != null` on meals
- Input: `meals` table, last 50 rows (30d window)

---

## Implementation Summary

All 5 tools implemented in `lib/ai/glevTools.ts`:
- Schema definitions added to `GLEV_TOOLS` array
- `GlevToolName` union extended
- Switch cases added to `executeGlevTool`
- Implementation functions added before `// ── Helpers ──` section

System prompt updated in `lib/ai/glevChatPrompt.ts`:
- TOOL CATALOG READ-Tools line expanded
- INTERACTION RULES: READ-Tool-Routing section added
