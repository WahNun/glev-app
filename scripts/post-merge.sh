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

# Verify that every column referenced by lib/meals.ts::FULL_COLS exists
# in the live Supabase `meals` table. fetchMeals() silently falls back
# to MID_COLS / CORE_COLS when a column is missing, which strips every
# curve-aggregate field and leaves chips stuck in "VORLÄUFIG". Catch
# that drift here so a merged-but-not-applied migration is noticed
# before the first request. Non-fatal: exit 78 means SUPABASE_ACCESS_TOKEN
# is unset (skip), exit 1 means missing columns (warn loudly but still
# allow post-merge to finish).
echo "[post-merge] checking meals schema drift …"
set +e
node scripts/check-meals-schema.mjs
schema_rc=$?
set -e
if [ "$schema_rc" -eq 0 ]; then
  echo "[post-merge] meals schema OK"
elif [ "$schema_rc" -eq 78 ]; then
  echo "[post-merge] meals schema check skipped (SUPABASE_ACCESS_TOKEN not set)"
elif [ "$schema_rc" -eq 1 ]; then
  echo "[post-merge] WARNING: meals schema drift detected — apply pending migrations via 'npm run db:migrate'"
else
  echo "[post-merge] WARNING: meals schema check errored (rc=$schema_rc) — continuing"
fi
