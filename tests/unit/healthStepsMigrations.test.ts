/**
 * Migration-level contract test for Task #183.
 *
 * Asserts the on-disk SQL files declare the constraints the runtime
 * relies on. If a future migration accidentally drops one of these,
 * this test fails immediately rather than at runtime against prod.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const DAILY = resolve(
  process.cwd(),
  "supabase/migrations/20260519_add_daily_activity_summary.sql",
);
const EXERCISE = resolve(
  process.cwd(),
  "supabase/migrations/20260520_exercise_logs_source_unique.sql",
);

test("daily_activity_summary migration declares (user_id,date,source) unique key", () => {
  const sql = readFileSync(DAILY, "utf8");
  // Table + unique key the upsert relies on.
  expect(sql).toMatch(/create\s+table[^;]*daily_activity_summary/i);
  expect(sql).toMatch(
    /create\s+unique\s+index[^;]*\(\s*user_id\s*,\s*date\s*,\s*source\s*\)/i,
  );
  // CHECK constraints matching the route's range guards.
  expect(sql).toMatch(/steps\s*>=\s*0/i);
  expect(sql).toMatch(/active_minutes/i);
  // RLS enabled so unauthenticated clients cannot read the table.
  expect(sql).toMatch(/enable\s+row\s+level\s+security/i);
  // Source CHECK restricts initial rollout to apple_health.
  expect(sql).toMatch(/apple_health/);
});

test("exercise_logs_source_unique migration adds source-aware unique index", () => {
  const sql = readFileSync(EXERCISE, "utf8");
  expect(sql).toMatch(/exercise_logs/i);
  // The new index must include source so future connectors cannot
  // collide on the same external id across sources.
  expect(sql).toMatch(
    /unique[^;]*\(\s*user_id\s*,\s*source\s*,\s*external_id\s*\)/i,
  );
});
