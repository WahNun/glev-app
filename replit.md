# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system. The **Next.js 15 App Router** (`src/`) is the primary production frontend running on port 5000. Authentication and data storage are handled by **Supabase**.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Production frontend**: Next.js 15 App Router (`src/`) — port 5000
- **Database + Auth**: Supabase (PostgreSQL + Auth)
- **AI**: OpenAI GPT-5 via Replit AI Integrations (`AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **API server (dev support)**: Express 5 (`artifacts/api-server`)
- **Design sandbox**: React + Vite (`artifacts/mockup-sandbox`)

## Authentication

- Supabase Auth (email + password)
- Client: `src/lib/supabase.ts` using `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Session stored in Supabase cookies; `src/middleware.ts` protects all `/(protected)` routes
- `src/lib/auth.ts` — `signIn`, `signUp`, `signOut`, `getCurrentUser`

## Database: Supabase `meals` Table

Required columns:
```sql
id           uuid DEFAULT gen_random_uuid() PRIMARY KEY
user_id      uuid REFERENCES auth.users(id)
input_text   text
parsed_json  jsonb  -- array of {name, grams, carbs, protein, fat, fiber}
glucose_before integer
glucose_after  integer        -- NEW: add if missing
carbs_grams  integer
insulin_units decimal(5,2)
meal_type    text             -- NEW: FAST_CARBS | HIGH_PROTEIN | HIGH_FAT | BALANCED
evaluation   text             -- GOOD | LOW | HIGH | SPIKE
created_at   timestamptz DEFAULT now()
```

**Migration SQL** (run once in Supabase SQL editor):
```sql
ALTER TABLE meals ADD COLUMN IF NOT EXISTS glucose_after INTEGER;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS meal_type TEXT;
```

(glucose_before, carbs_grams, insulin_units, evaluation were added in an earlier migration)

## Database: Supabase `user_preferences` Table

Stores per-user UI preferences such as the long-press drag-and-drop card
order on the Dashboard and Insights pages.

```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dashboard_card_order    JSONB NOT NULL DEFAULT '[]'::jsonb,
  insights_card_order     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences"
  ON user_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

API: `GET /api/preferences` returns the saved arrays (empty when none),
`POST /api/preferences` upserts either or both keys
(`dashboard_card_order`, `insights_card_order`).

## Frontend Routes

All protected routes live under `src/app/(protected)/` and require Supabase auth.

| Route | Page |
|-------|------|
| `/dashboard` | Dashboard — flip cards, glucose trend, outcome chart, recent entries, seed data trigger |
| `/log` | Voice-first meal logging — mic button, dual panel (raw + parsed), macros, insulin preview |
| `/entries` | Entries table — expandable rows with full food breakdown |
| `/insights` | Deep analytics — performance tiles, meal type analysis, time-of-day, pattern detection |
| `/engine` | Glev Engine — AI insulin recommendation from historical data |
| `/import` | Import Center — CSV paste, preview, bulk import |
| `/settings` | Account / Settings — profile overview, glucose targets, ICR, notification toggles |

## Key Source Files

- `src/lib/meals.ts` — Meal interface, ParsedFood, saveMeal, fetchMeals, seedMealsIfEmpty, classifyMeal, computeEvaluation
- `src/lib/supabase.ts` — Supabase browser client
- `src/lib/auth.ts` — signIn, signUp, signOut, getCurrentUser
- `src/middleware.ts` — Next.js route protection
- `src/components/Layout.tsx` — Sidebar nav (desktop) + bottom nav + FAB (mobile)
- `src/app/api/parse-food/route.ts` — AI meal parser (returns full macros per food)
- `src/app/(protected)/layout.tsx` — Protected layout wrapper

## Core Logic

### Meal Classification (`classifyMeal`)
- `FAST_CARBS`: carbs ≥ 45g
- `HIGH_PROTEIN`: protein ≥ 25g and dominant
- `HIGH_FAT`: fat ≥ 20g and dominant
- `BALANCED`: otherwise

### Dose Evaluation (`computeEvaluation`)
- ICR formula: `estimated = carbs/15 + max(0, (glucose-110)/50)`
- `GOOD`: ratio within 0.65–1.35
- `HIGH`: ratio > 1.35 (overdose)
- `LOW`: ratio < 0.65 (underdose)

### Glev Engine (`engine/page.tsx`)
- Finds historical meals with ±12g carbs + ±35 mg/dL glucose similarity
- 3+ GOOD matches → HIGH confidence (historical average)
- 1–2 matches → MEDIUM confidence (blended)
- 0 matches → LOW confidence (ICR formula only)

### Seed Data (`seedMealsIfEmpty`)
- Called on dashboard load; inserts 31 realistic T1D meals if user has 0 entries
- Covers breakfast/lunch/dinner, varied meal types, realistic glucose/insulin values

## Design Tokens

```
Background:  #09090B
Surface:     #111117
Accent:      #4F6EF7
Green:       #22D3A0
Pink:        #FF2D78
Orange:      #FF9500
Border:      rgba(255,255,255,0.08)
```

## Dev Commands

```bash
pnpm --filter @workspace/glev run dev          # Start Next.js app (port 5000, clears .next cache)
pnpm --filter @workspace/glev exec tsc --noEmit  # TypeScript check
pnpm --filter @workspace/api-server run dev    # Start Express API server
```

## Notes

- `dev` script runs `rm -rf .next && next dev --port 5000` to prevent stale cache crashes
- Voice input uses Web Speech API with `window as unknown as Record<string, unknown>` cast
- Settings (ICR, glucose targets, notifications) persist in `localStorage` under `glev_settings`
- ParsedFood now includes `carbs, protein, fat, fiber` macros (updated in v3)
- Backward-compatible evaluation display: handles both old values (OVERDOSE/UNDERDOSE) and new (HIGH/LOW)
