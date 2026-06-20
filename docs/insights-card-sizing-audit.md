# Insights Card Sizing Audit — 2026-06-20

## Context

TestFlight bug: cards inside each Insights cluster pager had different heights/widths depending on their content, causing inconsistent snapping and an unsettled visual feel.

## Architecture

All clusters share one pager component: `InsightsSwipePager` (in `app/(protected)/insights/page.tsx`).  
It is instantiated once per cluster via the `[cluster]/page.tsx` → `InsightsClusterView` path.

```
InsightsClusterView (page.tsx ~L260)
  └── InsightsSwipePager (page.tsx ~L4702)
        └── horizontal scroll-snap div
              └── slot div × N  (one per card)
                    └── FlipCard (with minHeight=CARD_MIN_H)
```

## Cluster → Card map

| Cluster ID | Cards (visible) | Sizing source |
|---|---|---|
| `glucose-basics` | TIR, Avg-BG+GMI, Glucose Trend, Hypo Events, Hyper Events, CV | `FlipCard minHeight={CARD_MIN_H}` |
| `meals-bolus` | Meal Timing, Post-Bolus Trend, TDD, Bolus Pattern, Carb Absorption, Post-Bolus BG (+ gated variants) | `FlipCard minHeight={CARD_MIN_H}` |
| `adaptive-engine` | Adaptive Engine card (collapsible panel, tall) | `FlipCard minHeight={CARD_MIN_H}` |
| `workout-activity` | Workout stats cards | `FlipCard minHeight={CARD_MIN_H}` |
| `cycle-symptoms` | Cycle snapshot, Symptom log | `FlipCard minHeight={CARD_MIN_H}` |

`CARD_MIN_H = "clamp(280px, calc(100dvh - 380px), 360px)"` (line 1328) — applied to every FlipCard front face via CSS `minHeight`. This ensures no card is shorter than ~280 px, but **does not cap the max** — content-heavy cards (sparklines, bar charts) grow taller.

## Root cause

`InsightsSwipePager` measured each card individually with a `ResizeObserver` and set the pager container height to `heights[active] + SLOT_PAD_V` (lines 4981–4984 before fix). As the user swiped, the container animated to the new active card's height, causing every card to look a different size.

## Fix applied (2026-06-20)

**File:** `app/(protected)/insights/page.tsx`

1. **`pagerHeight` computation** — changed from `heights[active]` to `Math.max(...Object.values(heights))`.  
   All measured heights are retained; the pager sizes to the tallest card. The `transition: "height 120ms ease"` on the scroller container is kept for graceful response to card additions/removals, but no longer fires during normal swiping.

2. **Slot `alignItems`** — changed from `"center"` to `"flex-start"`.  
   Short cards now top-anchor within the uniform pager height instead of floating in the middle, which matches the Glev data-card reading direction (top → bottom).

## What was NOT changed

- `CARD_MIN_H` — unchanged; still ensures cards don't collapse below 280 px.
- `FlipCard minHeight` prop on all card call-sites — unchanged.
- Pager width: each slot is already `flex: "0 0 100%"` + `boxSizing: "border-box"` → always 100% of scroller viewport. No width drift was present.
- The `transition: "height 120ms ease"` on the scroller — kept for non-swipe height changes.
