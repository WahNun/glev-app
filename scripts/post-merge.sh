#!/bin/bash
# Post-merge setup for Glev (Next.js + npm + Supabase).
#
# Glev is npm-only and uses Supabase as the database; SQL migrations
# under supabase/migrations/ are applied MANUALLY by the user via the
# Supabase SQL editor. There is no `db:push` script and no Drizzle —
# attempting `npm run db:push` would fail with "Missing script:
# db:push". Therefore this hook only re-installs npm dependencies
# from the lockfile.
set -e

npm ci --no-audit --no-fund --prefer-offline
