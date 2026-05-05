#!/bin/bash
# Post-merge setup for Glev (Next.js + npm + Supabase).
#
# Glev is npm-only and uses Supabase as the database; SQL migrations
# under supabase/migrations/ are applied MANUALLY by the user via the
# Supabase SQL editor. There is no `db:push` script and no Drizzle —
# attempting `npm run db:push` would fail with "Missing script:
# db:push". Therefore this hook only re-installs npm dependencies.
#
# We try `npm ci` first (fast, deterministic). If the lockfile is out
# of sync — which can happen when a merged task added a dependency but
# its lockfile commit hasn't landed yet — we fall back to `npm install`
# so the environment still ends up usable. The Supabase step is left to
# the user as documented in the project goal.
set -e

if npm ci --no-audit --no-fund --prefer-offline; then
  echo "[post-merge] npm ci succeeded"
else
  echo "[post-merge] npm ci failed (likely lockfile out of sync) — falling back to npm install"
  npm install --no-audit --no-fund
  echo "[post-merge] npm install succeeded — pnpm-lock.json may need to be committed"
fi
