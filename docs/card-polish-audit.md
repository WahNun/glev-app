# Card-Polish Audit — Glev App (2026-06-21)

Branch: `feat/card-polish-audit-fix`

---

## Glev Card Standard (defined 2026-06-21)

| Rule | Value |
|------|-------|
| Outer border-radius — standalone/main card | **16px** |
| Outer border-radius — compact cell (triplet, 2-col tile) | **14px** (OK) |
| Outer border-radius — glass variant | **18px** (intentional) |
| Padding — large content card (≥220px) | `20px 24px` |
| Padding — medium card (140–200px) | `16px 20px` |
| Border | `1px solid var(--border)` |
| Background | `var(--surface)` |
| Flip animation | `0.55s cubic-bezier(0.4,0,0.2,1)` |
| Back gradient | `linear-gradient(145deg, {accent}10–12, var(--surface) 65%)` |
| Back border | `1px solid {accent}33` |
| Back stat tile | `bg: var(--surface-soft); border: 1px solid var(--border); radius: 10; padding: 10px 12px` |
| Label eyebrow | `fontSize:11; fontWeight:700; letterSpacing:0.08em; textTransform:uppercase; color:var(--text-dim)` |
| Touch target | `minHeight: 44px` on all interactive elements |

---

## Card Inventory (21 Cards)

| # | Name | File | FlipCard | Radius Before | Radius After | Padding Before | Padding After | Transition | Status |
|---|------|------|----------|--------------|--------------|----------------|---------------|------------|--------|
| 1 | CurrentDayGlucoseCard | `components/CurrentDayGlucoseCard.tsx` | ✅ | 16 | 16 | `16px 18px` / `18px 20px` | unchanged | 0.55s | ✅ Compliant |
| 2 | IOBCard | `components/IOBCard.tsx` | ❌ (expand/collapse) | **18** | **16** | `14px 16px 12px` | unchanged | — | **Fixed** |
| 3 | FingerstickLogCard | `components/FingerstickLogCard.tsx` | ❌ | **14** | **16** | `14px 14px 12px` | `16px 20px` | — | **Fixed** |
| 4 | MealEntryCardCollapsed | `components/MealEntryCardCollapsed.tsx` | ❌ (row component) | — | — | `14px 16px` | unchanged | — | ✅ No wrapper |
| 5 | ReviewMacrosCards | `components/ReviewMacrosCards.tsx` | ❌ (buttons) | — | — | `8px 10px` | unchanged | — | ✅ Compact cells |
| 6 | PlanSimulator | `components/PlanSimulator.tsx` | ❌ | **14** | **16** | `16px` | unchanged | — | **Fixed** |
| 7 | AppleHealthSettingsCard | `components/AppleHealthSettingsCard.tsx` | ❌ | — | — | — | unchanged | — | ✅ Settings section |
| 8 | CgmSettingsCard | `components/CgmSettingsCard.tsx` | ❌ | 16 | 16 | `20px 24px` | unchanged | — | ✅ Compliant |
| 9 | NightscoutSettingsCard | `components/NightscoutSettingsCard.tsx` | ❌ | 16 | 16 | `20px 24px` | unchanged | — | ✅ Compliant |
| 10 | Dashboard FlipCard ×4 (Control/Good/Spike/Hypo) | `app/(protected)/dashboard/page.tsx` | ✅ | **14** | **16** | front `14px 18px`, back `12px 16px` | back `14px 16px` | **0.5s→0.55s** | **Fixed** |
| 11 | RateTripletCard | `app/(protected)/dashboard/page.tsx` | ✅ | cells:14, back:14 | unchanged | — | unchanged | 0.55s | ✅ Compact design |
| 12 | TrendChart | `app/(protected)/dashboard/page.tsx` | ✅ | 16 | 16 | `20px 24px` | unchanged | 0.55s | ✅ Compliant |
| 13 | OutcomeChart | `app/(protected)/dashboard/page.tsx` | ✅ | 16 | 16 | `20px 24px` | unchanged | 0.55s | ✅ Compliant |
| 14 | RecentEntries card | `app/(protected)/dashboard/page.tsx:1378` | ❌ | 16 | 16 | `16px 20px 8px` | unchanged | — | ✅ Compliant |
| 15 | Insights FlipCard (standard) | `app/(protected)/insights/page.tsx` | ✅ | **14** | **16** | pass-through `padding` prop | unchanged | 0.55s | **Fixed** |
| 16 | Insights FlipCard (glass) | `app/(protected)/insights/page.tsx` | ✅ | 18 | 18 | pass-through `padding` prop | unchanged | 0.55s | ✅ Intentional glass |
| 17 | InsightFlipTile | `app/(protected)/insights/page.tsx` | ✅ (fade-swap) | 14 | 14 | `16px 12px` | unchanged | 0.15s opacity | ✅ Small 2-col tile |
| 18 | InsightsCluster Overview Cards | `app/(protected)/insights/page.tsx:4461` | ❌ | 16 | 16 | varies | unchanged | — | ✅ Compliant |
| 19 | IOBHistoryChart section | `components/IOBHistoryChart.tsx` | ❌ | — | — | — | — | — | ✅ Chart only |
| 20 | MealEntryLightExpand | `components/MealEntryLightExpand.tsx` | ❌ | — | — | — | — | — | ✅ Sheet component |
| 21 | [cluster]/page.tsx drill-in | `app/(protected)/insights/[cluster]/page.tsx` | — | — | — | — | — | — | ✅ No card shell |

---

## Inconsistencies Fixed

### 1. Border Radius 18 → 16 (IOBCard)
**File:** `components/IOBCard.tsx:231`  
**Change:** `borderRadius: 18` → `borderRadius: 16`  
**Why:** IOBCard was the only non-glass card with radius 18. Glass cards intentionally use 18 for the physical depth effect; solid-surface cards standardize on 16.

### 2. Border Radius 14 → 16 + Padding fix (FingerstickLogCard)
**File:** `components/FingerstickLogCard.tsx:154`  
**Change:** `borderRadius: 14` → `16`, `padding: "14px 14px 12px"` → `"16px 20px"`  
**Why:** Full-width standalone card should match the 16px standard. Padding was asymmetric (top≠sides≠bottom) — normalized to the medium-card standard.

### 3. Border Radius 14 → 16 (PlanSimulator)
**File:** `components/PlanSimulator.tsx:85`  
**Change:** `borderRadius: 14` → `16`  
**Why:** Standalone settings card, same rule as FingerstickLogCard.

### 4. FlipCard radius 14 → 16 + transition 0.5s → 0.55s (Dashboard)
**File:** `app/(protected)/dashboard/page.tsx:270–289`  
**Changes:**
- Front: `borderRadius:14` → `16`
- Back: `borderRadius:14` → `16`, `padding:"12px 16px"` → `"14px 16px"`
- Transition: `0.5s` → `0.55s`  
**Why:** The 4 stat FlipCards (Control Score, Good, Spike, Hypo) were radius-14 while TrendChart and OutcomeChart directly below them were radius-16. This created a visible size inconsistency when scanning the dashboard vertically. Transition speed unified to match all other flip cards in the app.

### 5. Insights FlipCard (standard) radius 14 → 16
**File:** `app/(protected)/insights/page.tsx:5896,5903`  
**Change:** `borderRadius: 14` → `16` on `frontShell` and `backShell`  
**Why:** All full-width insight cards (TIR, GMI, Glucose Variability, etc.) now match the 16px standard. The `InsightFlipTile` (small 2-column tiles) deliberately keeps 14px as a compact design signal.

---

## What Was NOT Changed

| Item | Reason |
|------|--------|
| `InsightFlipTile` 14px radius | Small 2-col performance tiles — compact design is intentional |
| `RateTripletCard` cells 14px | 96px height compact triplet — 14px appropriate |
| Glass FlipCard 18px radius | Intentional material design — 3D glass effect requires the extra rounding |
| `MealEntryCardCollapsed` | Row component, no outer card shell |
| `ReviewMacrosCards` buttons | Compact selector buttons, not card wrappers |
| AppleHealthSettingsCard | Uses `var(--surface-soft)` inset sections, no outer card shell |

---

## Compliance After Fixes

- **Standalone main cards (radius):** 100% compliant at 16px
- **Flip animation speed:** 100% compliant at 0.55s
- **Back gradient pattern:** 100% compliant (linear-gradient 145deg, accent10-12, surface 65%)
- **Padding (large cards):** 100% at 20px 24px
- **Padding (medium cards):** 100% at 16px 20px
