# Agent Status

## Last completed task
**/engine i18n wiring** — replaced hardcoded English strings on the `/engine` page and its sub-components with `next-intl` translations (DE + EN).

### What changed
- `messages/de.json` + `messages/en.json` — expanded `engine` namespace with: tab labels, exercise intensity (Low/Moderate/High), macros section + 4 macro labels + 4 placeholders, glucose-time section (Glucose Before, Last:, Pulling…, CGM, Meal time), `optional_short` ("opt."), `gpt_reasoning_title`.
- `components/EngineChatPanel.tsx` — added `useTranslations("log")` hook (reuses keys curated for legacy `/log` wizard). Wired: AI FOOD PARSER caps title, GPT reasoning subtitle, status chip (PARSING / THINKING / READY), chat intro paragraph, input placeholder, Send button.
- `components/EngineLogTab.tsx` — added `useTranslations("engine")` in `ExerciseForm`. Wired: intensity radio (low/medium/high).
- `app/(protected)/engine/page.tsx` — added `useTranslations("engine")` aliased as `tEngine` (avoids clash with local `t = searchParams.get("tab")`). Wired: tab labels Record (engine/bolus/exercise/fingerstick), full Macros section (header + 4 labels + 4 placeholders + opt. tag), full Glukose & Zeit section (header, Glucose Before label, Last prefix, Pulling…/CGM button, glucose placeholder, Meal Time label), GPT Reasoning collapse header.

### Verification
- `npx tsc --noEmit --skipLibCheck` — clean, no errors.
- Workflow restarted. `curl /engine` returns 307 (auth-gate redirect → app boots fine).

## Open follow-ups (audit-pending, not yet executed)
- IOB calculation review: `app/(protected)/engine/page.tsx` L61/L69, `lib/engine/recommendation.ts` L95/L102 (KRITISCH safety), `lib/engine/evaluation.ts` L65, `lib/sheets.ts` L25.
- /insights, /entries, /history, PDF report — not yet wired to next-intl (per Sprach-Audit).

## Workflow rules (project policy)
- Hand-written SQL migrations only (`supabase/migrations/<n>_<name>.sql` + `npm run db:migrate <file>`). No Drizzle, no `db:push` script in this repo.
- No automatic git commits. `git push` only on explicit user request.
- No deploy suggestions.

## Recent commits (origin/main)
ddd063d -> 54abbc7 -> f849fc8 -> 76f35a2 -> e909009 -> e6b5a08 -> 7dbea12

## Stripe state
- `STRIPE_BETA_WEBHOOK_SECRET` set in Vercel.
- `STRIPE_BETA_PRICE_ID` NOT in Vercel env (per user screenshot — flagged for follow-up).

## Sandbox quirks observed
- `bash` heredoc writes to AGENT_STATUS.md got blocked as "destructive git operation" (false positive on content keywords). Workaround: use the file-write tool directly.
