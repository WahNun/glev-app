# Agent Status — 2026-04-28

## Last completed
**Brand-mark restored in nav + Sprechen, with grey/glow treatment**

User clarified the previous round went too far: the simplified hexagon
SVG outline I'd dropped into the nav was *too* abstract — they wanted
the actual Glev brand mark (the multi-node logo) but recoloured monochrome
so it visually weighs the same as the other line-icon tabs.

### Files touched
- `components/Layout.tsx`
  - Re-imported `GlevLogo`.
  - **Desktop NAV Glev item**: replaced the inline hexagon SVG with
    `<GlevLogo size={18} color={a ? ACCENT : "rgba(255,255,255,0.45)"} bg="transparent"/>`,
    wrapped in a span that applies a `drop-shadow(0 0 6px ${ACCENT}99)`
    glow when active.
  - **Mobile MobileTab Glev**: same swap — inline hexagon SVG → real
    `GlevLogo size={22}` with NAV_INACTIVE / ACCENT colour, span wrapper
    with `drop-shadow(0 0 8px ${ACCENT}aa)` when active. Tab still opens
    the action sheet on tap (no navigation), still highlights when
    pathname starts with `/engine`. Elevated FAB stays gone.
- `app/(protected)/engine/page.tsx`
  - **Sprechen button icon**: replaced the inline hexagon SVG with
    `<GlevLogo size={22} color={ACCENT} bg="transparent"/>` inside a
    span carrying the `drop-shadow` filter that strengthens while
    `recording`. `engRecHalo` keyframes / dark SURFACE bg / ACCENT
    border / "Sprechen"/"Stopp"/"Verarbeite…" text all unchanged.
- `components/EngineChatPanel.tsx`
  - **Removed** the entire `mobileChip` standalone pill and the
    separate `desktopHeader`. They're replaced by a single `header`
    JSX (combined "AI FOOD PARSER" in grey + "GPT reasoning" in
    ACCENT, plus the READY/PARSING/THINKING status pill on the right)
    rendered at the top of the card on both mobile and desktop.
  - The chat card is now a single bordered surface on mobile too (no
    more chip + card stack). `expanded`/`onToggleExpanded`/`hasUsedVoice`
    props are kept for backwards compatibility but no longer drive
    rendering — engine page only ever passes `expanded={true}` anyway.
  - Mobile body height reservation reduced from 540 + chip(52) →
    540 (header is now part of the card, no separate chip to subtract).

### Validation
- `npx tsc --noEmit --skipLibCheck` → clean.
- Workflow restarted; running.
- 7 new browser console logs post-restart — i18n merge churn, no errors.

## Carry-over (NOT touched this turn)
- **BE/KE/g feature** — paused mid-stream, all dormant:
  - Migration `20260428_add_profiles_carb_unit.sql` applied ✓
    (`profiles.carb_unit text DEFAULT 'g' CHECK in g/BE/KE`).
  - `lib/carbUnits.ts` — type + helpers ready.
  - **Pending**: `useCarbUnit()` hook, settings selector,
    /log + /engine + /history wiring. User has not asked to resume.
- 46 existing browser console logs from i18n task #21+#24+#26 merges —
  non-blocker churn.

## Hard rules (from project_goal — every turn)
- ZERO Drizzle, ZERO `db:push`, hand-written SQL via `npm run db:migrate <file>`.
- NEVER `git commit` (auto), `git push` only on explicit user request.
- NEVER `suggest_deploy`.
- Communicate German, concise, honest.
- Overwrite this file after every completed task.
