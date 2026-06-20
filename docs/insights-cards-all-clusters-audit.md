# Insights Cards All-Clusters Height Audit — 2026-06-21

## Why PR #21 was not enough

PR #21 (2026-06-20) changed `pagerHeight` from `heights[active]` to
`Math.max(...Object.values(heights))`. That made the *scroller container* the
same height for all slots, but cards inside each slot still render at their
**natural content height**. The slot wrapper has `overflow: hidden`, so the
tallest card was silently clipped at the bottom and shorter cards had visible
whitespace below their glass surface. Two distinct bugs:

| Bug | Location | Effect |
|---|---|---|
| `SLOT_PAD_V = 6` but slot has `padding: "6px 14px"` = 12 px total vertical | `InsightsSwipePager` | Tallest card overflows slot by 6 px → clipped by `overflow:hidden` → looks 6 px shorter than intended |
| `alignItems: "flex-start"` on slot + no forced card height | `InsightsSwipePager` slot | Short cards render at `CARD_MIN_H` (~320 px) inside a 346 px slot → 26 px visible gap below card surface → looks "shorter" than the adjacent tall card |

## Clusters and their card heights (approximate, iPhone SE viewport, 100dvh ≈ 667px → CARD_MIN_H ≈ 287px)

> Heights are natural content heights before the fix. After the fix all cards in a
> cluster render at `max(CARD_MIN_H, tallest-sibling-height)`.

| Cluster | Card ID | Natural height (approx) | Tallest in cluster? |
|---|---|---|---|
| `glucose-basics` | time-in-range | ~310 px | |
| `glucose-basics` | gmi-a1c | ~290 px | |
| `glucose-basics` | glucose-trend | ~360 px | ✓ |
| `glucose-basics` | hypo-events | ~295 px | |
| `glucose-basics` | hyper-events | ~295 px | |
| `glucose-basics` | glucose-variability | ~290 px | |
| `meals-bolus` | meal-evaluation | ~340 px | ✓ |
| `meals-bolus` | post-bolus-trend | ~330 px | |
| `meals-bolus` | meal-type | ~310 px | |
| `meals-bolus` | time-of-day | ~295 px | |
| `adaptive-engine` | adaptive-engine | ~440 px (collapsible rows) | ✓ |
| `adaptive-engine` | tdd | ~295 px | |
| `adaptive-engine` | patterns | ~300 px | |
| `workout-activity` | workout-outcomes | ~320 px | |
| `workout-activity` | workout-bg-response | ~340 px | ✓ |
| `workout-activity` | workout-patterns | ~300 px | |
| `workout-activity` | workout-type-patterns | ~300 px | |
| `workout-activity` | performance-tiles | ~310 px | |
| `workout-activity` | daily-steps | ~295 px | |
| `workout-activity` | active-day-outcomes | ~300 px | |
| `cycle-symptoms` | cycle-symptoms | ~350 px | ✓ (only card) |

## Architecture

All 5 clusters share one `InsightsSwipePager` instance (one per cluster page).
There is only ONE pager component — the Explore agent confirmed no variants.

```
InsightsClusterView (page.tsx ~L260)
  └── InsightsSwipePager (page.tsx ~L4703)  ← shared by ALL clusters
        └── scroller div  (height = pagerHeight)
              └── slot div × N  (flex-stretch → same height as scroller)
                    └── inner div [ref]  ← ResizeObserver target
                          └── FlipCard (minHeight = CARD_MIN_H)
```

## Fix applied 2026-06-21

**File:** `app/(protected)/insights/page.tsx`

### Change 1 — SLOT_PAD_V: 6 → 12
Slot padding is `"6px 14px"` (6 px top + 6 px bottom = 12 px total vertical).
`SLOT_PAD_V` was 6, causing `pagerHeight = maxMeasured + 6` instead of the
correct `maxMeasured + 12`. The tallest card overflowed the slot content area
by 6 px and was clipped. Now `pagerHeight = maxMeasured + 12` and the tallest
card fits exactly.

### Change 2 — CSS custom property `--glev-card-h` on slot inner div
After computing `maxMeasured`, we derive `targetCardH = maxMeasured ?? 0` and
inject it as a CSS custom property on each slot's inner wrapper div:
```tsx
style={{ width: "100%", "--glev-card-h": `${targetCardH}px` } as React.CSSProperties}
```
CSS custom properties cascade to all descendants, so `FlipCard` can read it.

### Change 3 — FlipCard grid uses `max(CARD_MIN_H, var(--glev-card-h, 0px))`
The flip stage grid now has:
```tsx
minHeight: `max(${minHeight || "0px"}, var(--glev-card-h, 0px))`
```
Short cards (where `CARD_MIN_H < targetCardH`) grow their glass surface to fill
the slot. Tall cards (where natural height > `targetCardH`) are unaffected.
Expanded FlipCard backs that exceed `targetCardH` grow beyond it normally —
`ResizeObserver` picks up the new height, `maxMeasured` updates, `targetCardH`
updates, and the pager grows. No feedback loop: the tallest card always
dominates `maxMeasured`, so the CSS variable stabilises after one re-measure.

### Change 4 — `performance-tiles` plain-div uses same CSS max()
The `performance-tiles` card (workout cluster) uses a plain `<div>` instead of
`FlipCard`. Its `minHeight` was updated to:
```tsx
minHeight: `max(${CARD_MIN_H}, var(--glev-card-h, 0px))`
```
so it grows identically to FlipCard siblings.

## Convergence proof

| Step | What happens |
|---|---|
| 1 | Cards render without `targetCardH`. `--glev-card-h: 0px`. FlipCards render at `CARD_MIN_H`. |
| 2 | ResizeObserver fires. `heights = {0: H0, 1: H1, …}`. `maxMeasured = max(H0…Hn)`. `targetCardH = maxMeasured`. |
| 3 | `--glev-card-h` updates. Short cards grow to `targetCardH`. ResizeObserver fires for them: all measure `targetCardH`. |
| 4 | `maxMeasured` unchanged (tall card still dominates). `targetCardH` unchanged. No further CSS changes. **Stable.** |

For expanded FlipCard backs: back content grows card above `targetCardH` →
ResizeObserver detects → `maxMeasured` increases → all cards grow → new stable
state at expanded height. Back to front flip: `minHeight` keeps card at
`targetCardH`, measurements stable.

## Visual verification

Screenshots needed per cluster (run `pnpm dev`, open `/insights/[cluster]` at
iPhone viewport, capture pager with all cards showing equal height):

- `docs/screenshots/insights-cards-equal-glucose-basics.png`
- `docs/screenshots/insights-cards-equal-meals-bolus.png`
- `docs/screenshots/insights-cards-equal-adaptive-engine.png`
- `docs/screenshots/insights-cards-equal-workout-activity.png`
- `docs/screenshots/insights-cards-equal-cycle-symptoms.png`
