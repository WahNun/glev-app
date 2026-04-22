# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system. The single active artifact is the **Dark Cockpit mockup** (`artifacts/mockup-sandbox`) — a fully interactive dark-mode prototype with desktop and mobile views. The backend API server (`artifacts/api-server`) handles data persistence, recommendation logic, and member authentication.

The `artifacts/glucojack` React/Vite web app was removed — the canvas mockup is now the primary interface.

## Authentication

- `members` table: id, name, email, password_hash, created_at
- Passwords hashed with `pbkdf2Sync` (SHA-512, 100k iterations, salt "glev-members-v1")
- `POST /api/auth/signup` — creates account, returns `{ok, member}`; 409 if email taken
- `POST /api/auth/login` — verifies credentials, returns `{ok, member}`; 401 on failure
- `LoginGate` frontend: tab-based toggle between "Create Account" and "Sign In" modes; real API calls; name from signup flows into `ProfilePage` avatar

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mockup**: React + Vite (artifacts/mockup-sandbox) — DarkCockpit with Desktop/Mobile toggle
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Charts**: Recharts
- **Routing**: Wouter

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Frontend (artifacts/glucojack/)
- `/` — Dashboard: control score, hypo/spike rate, glucose trend chart, evaluation breakdown
- `/log` — Quick Log: fast entry form (<10 seconds)
- `/entries` — Entry Log: filterable list with evaluation badges
- `/insights` — Patterns by meal type (FAST_CARBS, HIGH_FAT, HIGH_PROTEIN, BALANCED)
- `/recommend` — Decision Support: carb/glucose → insulin recommendation
- `/import` — Import Center: paste zone + CSV upload with preview

### Backend (artifacts/api-server/)
- `GET/POST /api/entries` — CRUD for glucose/insulin log entries
- `POST /api/entries/batch` — batch import
- `GET /api/entries/:id`, `DELETE /api/entries/:id` — single entry ops
- `GET /api/insights/dashboard` — control score, stats, recent entries
- `GET /api/insights/patterns` — meal type performance patterns
- `GET /api/insights/glucose-trend` — time-series glucose data
- `POST /api/recommendations` — insulin recommendation engine
- `GET /api/cgm/latest` — mock CGM reading (95–120 random); structured for Dexcom/Libre integration
- `POST /api/food/macros` — USDA FoodData Central lookup; body `{foods:[{name,portion}]}`; returns per-item + aggregate carbs/fiber/protein/fat/netCarbs; falls back to category estimation on timeout

### Core Logic
- `artifacts/api-server/src/lib/calculation.ts` — delta, speed, evaluation (GOOD/OVERDOSE/UNDERDOSE/CHECK_CONTEXT)
- `artifacts/api-server/src/lib/recommendation.ts` — insulin recommendation engine

### Database Schema (lib/db/src/schema/)
- `entries` table: timestamp, glucoseBefore, glucoseAfter, carbsGrams, insulinUnits, mealType, delta, speed, evaluation, notes

### API Contract
- `lib/api-spec/openapi.yaml` — single source of truth
- Generated React Query hooks: `lib/api-client-react/src/generated/api.ts`
- Generated Zod schemas: `lib/api-zod/src/generated/api.ts`

## Meal Types
- FAST_CARBS, HIGH_FAT, HIGH_PROTEIN, BALANCED

## Evaluation Classifications
- GOOD, OVERDOSE, UNDERDOSE, CHECK_CONTEXT
