# Loading Pattern Audit — 2026-06-21

Audit of all `<GlevLoadingPattern>` usages and `loading.tsx` files across the protected routes.

**Rule:** Page-level loading (whole page not ready) → `variant="splash"`. Component-level loading (sub-component within an already-rendered page) → `variant="skeleton"` or component-specific spinner.

| File | Context | Variant Decision | Notes |
|---|---|---|---|
| `app/(protected)/dashboard/loading.tsx` | Next.js route loading boundary for /dashboard | **splash** | Full page not yet rendered |
| `app/(protected)/dashboard/page.tsx` (inline guard) | SWR data fetch not yet resolved on first render | **splash** | `if (loading) return …` — whole page blocked |
| `app/(protected)/insights/loading.tsx` | Next.js route loading boundary for /insights | **splash** | Full page not yet rendered |
| `app/(protected)/insights/page.tsx` (inline guard) | SWR data fetch not yet resolved on first render | **splash** | `if (loading) return …` — whole page blocked |
| `app/(protected)/entries/loading.tsx` | Next.js route loading boundary for /entries | **splash** | Full page not yet rendered |
| `app/(protected)/entries/page.tsx` (inline guard) | Data fetch not yet resolved on first render | **splash** | Was a centered 60vh spinner; replaced with splash |
| `app/(protected)/engine/loading.tsx` | Next.js route loading boundary for /engine | **splash** | Full page not yet rendered |
| `app/(protected)/settings/` | No loading.tsx found | n/a | Settings sub-pages load synchronously from Supabase via SWR; no page-level skeleton needed currently |
| `app/(protected)/glev-ai/` | No loading.tsx found | n/a | glev-ai page uses its own streaming UI state; no page-level loading skeleton |

## What was NOT changed (skeleton stays correct)

- Any `RefreshingBar` usage inside already-rendered pages (sub-component refresh indicator)
- Mini-preview loading states (confidence breakdown, source card previews)
- Individual card or section skeletons within a page that is already visible
