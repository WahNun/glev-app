# Insights Cluster Card-Sizing FINAL Audit
**Date:** 2026-06-21  
**Branch:** hotfix/insights-cluster-card-heights-FINAL  
**Related PRs:** #21, #36 (prior attempts, incomplete)

---

## Cluster Inventory

| Cluster | ID | Cards | Pager-Component | Math.max-Lock | Card-Variants consistent |
|---|---|---|---|---|---|
| Glukose-Basics | `glucose-basics` | 6 | `InsightsSwipePager` (shared) | ✓ | ✓ |
| Mahlzeiten & Bolus | `meals-bolus` | 4 | `InsightsSwipePager` (shared) | ✓ | ✓ |
| Adaptiver Engine | `adaptive-engine` | 3 | `InsightsSwipePager` (shared) | ✓ | ✓ after this fix |
| Workout & Aktivität | `workout-activity` | 7 | `InsightsSwipePager` (shared) | ✓ | ✓ |
| Zyklus & Schlaf | `cycle-symptoms` | 1 | `InsightsSwipePager` (shared) | n/a (1 card) | ✓ |

**Pager-Konsolidierung:** Already consolidated — ONE shared `InsightsSwipePager` for all clusters since initial implementation. No per-cluster pager duplication existed.

---

## Root Cause of Drift (Adaptive Engine + any cluster with height variance)

`InsightsSwipePager` correctly computed `pagerHeight = Math.max(...heights) + SLOT_PAD_V` but **never applied that height back to the cards**. Cards only had `minHeight={CARD_MIN_H}` (a `clamp()` value capping at ~360px). The adaptive-engine card's content grows to ~480px. The short sibling cards (`tdd`, `patterns`) stayed at ~320px. Result: pager slot = 480px, but short cards are 320px tall — visual "drift."

```
Before fix:
  Slot (height: 480px, alignItems: flex-start)
    tdd card         → natural height 320px  ← 160px blank below = DRIFT
    adaptive-engine  → natural height 480px  ← fills slot
    patterns         → natural height 320px  ← 160px blank below = DRIFT
```

---

## Fix Applied

**Two surgical changes in `app/(protected)/insights/page.tsx`:**

### 1. CSS Custom Property on Slot (line ~5063)
```jsx
"--glev-pager-slot-h": `${maxMeasured != null ? maxMeasured : FIRST_PAINT_H}px`,
```
Set on every slot div inside `items.map(...)`. Cascades to all descendants. Value = the locked max measured height across ALL cards in the cluster.

### 2. FlipCard Flip Stage min-height (line ~5917)
```jsx
minHeight: minHeight
  ? `max(${minHeight}, var(--glev-pager-slot-h, 0px))`
  : "var(--glev-pager-slot-h, 0px)",
```
Uses CSS `max()` to pick the larger of:
- `CARD_MIN_H` clamp (existing per-card floor, ~280–360px)
- `--glev-pager-slot-h` (the tallest sibling's height, e.g. 480px)

```
After fix:
  Slot (height: 480px, alignItems: flex-start)
    tdd card         → min-height: max(320px, 480px) = 480px  ✓
    adaptive-engine  → min-height: max(360px, 480px) = 480px  ✓
    patterns         → min-height: max(320px, 480px) = 480px  ✓
```

### Why CSS max() and not prop-threading
- Cards are built as `React.ReactNode` before the pager has measured heights — you can't inject a dynamic `minHeight` prop retroactively without React.cloneElement (brittle).
- CSS custom properties cascade naturally; no wrapper restructure needed.
- FlipCards used outside the pager get `var(--glev-pager-slot-h, 0px)` = 0 fallback → no behavior change.

---

## Card-Component Audit

All cards use `FlipCard` with `minHeight={CARD_MIN_H}`. After fix, the flip stage takes `max(CARD_MIN_H, --glev-pager-slot-h)`. Common properties:

| Property | Value | Consistent |
|---|---|---|
| `width` | `100%` (inner wrapper) | ✓ all clusters |
| `min-height` | `max(CARD_MIN_H, --glev-pager-slot-h)` | ✓ after fix |
| No per-card `height` override | confirmed via grep | ✓ |
| Border-radius | 18px (glass variant) | ✓ |
| Padding | `12px 14px` (FlipCard default) | ✓ |
| Variant | `glass` (all insight cards) | ✓ |

---

## Visual Proof

Screenshots cannot be auto-generated locally (Playwright requires a live dev server with authenticated Supabase session). 

**→ Vercel Preview URL in PR body. Lucas: please verify each cluster manually by opening the preview on an iPhone-sized viewport (390×844) and swiping through all cards in:**
- [ ] Glukose-Basics (6 cards — check TIR vs. GMI vs. Trend height)
- [ ] Mahlzeiten & Bolus (4 cards)
- [ ] Adaptiver Engine (3 cards — this was the broken one)
- [ ] Workout & Aktivität (7 cards — cluster-locked, check skeleton)
- [ ] Zyklus & Schlaf (1 card — trivially uniform)

---

## Acceptance Criteria

- [x] ONE consolidated `InsightsSwipePager` for all clusters
- [x] `Math.max` lock on pagerHeight already existed
- [x] Cards now receive `min-height: max(CARD_MIN_H, --glev-pager-slot-h)` — all fill to tallest
- [x] No per-cluster workarounds
- [x] No per-card `height` hard overrides
- [x] Build passes (`pnpm build` → `✓ Compiled successfully`)
- [ ] Visual proof via Vercel Preview (manual verify required)
