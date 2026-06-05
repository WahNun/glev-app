// tests/unit/bgAtEntryInsulinSave.test.ts
//
// Regression guard: AI voice path (confirm-action) must populate
// cgm_glucose_at_log when saving bolus or basal insulin logs.
//
// Root cause (2026-06-04): execLogBolusEntry / execLogBasalEntry in
// app/api/ai/confirm-action/route.ts built the INSERT row without calling
// getHistory(), so cgm_glucose_at_log was always NULL in the voice path.
// The UI path (insertInsulinLog via lib/insulin.ts) is correct because the
// caller passes cgm_glucose_at_log from the live CGM read in the Engine.
//
// Covers:
//   1. fetchBgNearTimestamp helper exists in confirm-action route source.
//   2. execLogBolusEntry passes cgm_glucose_at_log to the INSERT row.
//   3. execLogBasalEntry passes cgm_glucose_at_log to the INSERT row.
//   4. fetchBgNearTimestamp returns null when no CGM reading is within window.
//   5. getHistory import is present in the confirm-action route.
//   6. insulin_logs schema has cgm_glucose_at_log column (nullable).

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_PATH = join(process.cwd(), "app/api/ai/confirm-action/route.ts");
const src = readFileSync(SRC_PATH, "utf8");

// ── 1. Helper function exists ─────────────────────────────────────────────

test("confirm-action: fetchBgNearTimestamp helper is defined", () => {
  expect(src).toContain("async function fetchBgNearTimestamp(");
  expect(src).toContain("windowMs = 10 * 60_000");
});

// ── 2. Bolus executor uses cgm_glucose_at_log ─────────────────────────────

test("confirm-action: execLogBolusEntry calls fetchBgNearTimestamp", () => {
  // Find the execLogBolusEntry function body
  const bolusStart = src.indexOf("async function execLogBolusEntry(");
  const bolusEnd = src.indexOf("\nasync function", bolusStart + 1);
  const bolusBody = src.slice(bolusStart, bolusEnd > -1 ? bolusEnd : undefined);

  expect(bolusBody).toContain("fetchBgNearTimestamp(userId");
  expect(bolusBody).toContain("cgm_glucose_at_log: bgAtLog");
});

// ── 3. Basal executor uses cgm_glucose_at_log ─────────────────────────────

test("confirm-action: execLogBasalEntry calls fetchBgNearTimestamp", () => {
  const basalStart = src.indexOf("async function execLogBasalEntry(");
  const basalEnd = src.indexOf("\nasync function", basalStart + 1);
  const basalBody = src.slice(basalStart, basalEnd > -1 ? basalEnd : undefined);

  expect(basalBody).toContain("fetchBgNearTimestamp(userId");
  expect(basalBody).toContain("cgm_glucose_at_log: bgAtLog");
});

// ── 4. fetchBgNearTimestamp returns null when outside window ──────────────

test("confirm-action: fetchBgNearTimestamp guards against readings outside window", () => {
  // The filter must be .filter((r) => r.dist <= windowMs)
  expect(src).toContain(".filter((r) => r.dist <= windowMs)");
  // And return null when no candidates
  expect(src).toContain("if (candidates.length === 0) return null");
});

// ── 5. CGM import present ─────────────────────────────────────────────────

test("confirm-action: imports getHistory from @/lib/cgm", () => {
  expect(src).toContain('import { getHistory } from "@/lib/cgm"');
});

// ── 6. Schema: cgm_glucose_at_log is nullable in insulin_logs ────────────

test("insulin_logs schema: cgm_glucose_at_log column is nullable (no NOT NULL)", () => {
  const migDir = join(process.cwd(), "supabase/migrations");
  const files = require("node:fs").readdirSync(migDir) as string[];
  const migFile = files.find((f) => f.includes("add_insulin_exercise_logs"));
  expect(migFile).toBeTruthy();
  const mig = readFileSync(join(migDir, migFile!), "utf8");
  expect(mig).toContain("cgm_glucose_at_log");
  // Must NOT be NOT NULL — the column must allow NULL for when CGM is unavailable
  const colLine = mig.split("\n").find((l) => l.includes("cgm_glucose_at_log"));
  expect(colLine).toBeTruthy();
  expect(colLine!.toUpperCase()).not.toContain("NOT NULL");
});

// ── 7. No cgm_glucose_at_log in the OLD bolus/basal row builders ─────────
// (regression: make sure we didn't accidentally add it twice)

test("confirm-action: cgm_glucose_at_log appears exactly twice in each executor body (once fetch, once row)", () => {
  const bolusStart = src.indexOf("async function execLogBolusEntry(");
  const bolusEnd   = src.indexOf("\nasync function execLogBasalEntry(");
  const bolusBody  = src.slice(bolusStart, bolusEnd);
  const bolusCount = (bolusBody.match(/cgm_glucose_at_log/g) ?? []).length;
  expect(bolusCount).toBe(1); // only in the row object

  const basalStart = src.indexOf("async function execLogBasalEntry(");
  const basalEnd   = src.indexOf("\nasync function execLogFingerstick(");
  const basalBody  = src.slice(basalStart, basalEnd > -1 ? basalEnd : undefined);
  const basalCount = (basalBody.match(/cgm_glucose_at_log/g) ?? []).length;
  expect(basalCount).toBe(1); // only in the row object
});
