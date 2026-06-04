/**
 * Alarm threshold evaluation tests
 *
 * Verifies that the fire/suppress decision in all three push-notification
 * edge functions (hypo-check, elevated-check, hyper-check) correctly reads
 * and applies the user's custom threshold from user_settings.
 *
 * A regression here means a user who changes their alarm threshold in
 * Sensor & Alarme keeps receiving alarms at the old (default) threshold —
 * the worst kind of silent failure for a T1D safety-critical app.
 *
 * Strategy
 * ────────
 * The alarm-evaluation logic inside each Deno Edge Function is pure:
 *   - hypo-check:     fires when latestValue  < (low_alarm_threshold_mgdl   ?? 70)
 *   - elevated-check: fires when latestValue  > (elevated_alarm_threshold_mgdl ?? 140)
 *   - hyper-check:    fires when latestValue  > (high_alarm_threshold_mgdl  ?? 180)
 *
 * We cannot import the Deno source directly from Node.js, so we:
 *   1. Re-implement the same pure decision function in this file.
 *   2. Write boundary + custom-threshold tests against it.
 *   3. Add schema-contract tests that read the Edge Function source files
 *      and assert the comparison operators, column names, and enabled-flag
 *      filter are exactly what the pure functions model.
 *
 * Coverage
 * ────────
 * Hypo-check (fires when value < threshold):
 *   1.  Default threshold (70): value one below → fires
 *   2.  Default threshold (70): value at threshold → no fire (boundary)
 *   3.  Default threshold (70): value one above → no fire
 *   4.  Custom threshold 60: value one below → fires
 *   5.  Custom threshold 60: value at threshold → no fire (boundary)
 *   6.  Custom threshold 60: value one above → no fire
 *   7.  null threshold → falls back to default 70
 *
 * Elevated-check (fires when value > threshold):
 *   8.  Default threshold (140): value one above → fires
 *   9.  Default threshold (140): value at threshold → no fire (boundary)
 *  10.  Default threshold (140): value one below → no fire
 *  11.  Custom threshold 150: value one above → fires
 *  12.  Custom threshold 150: value at threshold → no fire (boundary)
 *  13.  Custom threshold 150: value one below → no fire
 *  14.  null threshold → falls back to default 140
 *
 * Hyper-check (fires when value > threshold):
 *  15.  Default threshold (180): value one above → fires
 *  16.  Default threshold (180): value at threshold → no fire (boundary)
 *  17.  Default threshold (180): value one below → no fire
 *  18.  Custom threshold 200: value one above → fires
 *  19.  Custom threshold 200: value at threshold → no fire (boundary)
 *  20.  Custom threshold 200: value one below → no fire
 *  21.  null threshold → falls back to default 180
 *
 * Schema-contract (disabled alarm must never fire):
 *  22.  hypo-check source filters on low_alarm_enabled = true
 *  23.  elevated-check source filters on elevated_alarm_enabled = true
 *  24.  hyper-check source filters on high_alarm_enabled = true
 *
 * Schema-contract (threshold column names):
 *  25.  hypo-check reads low_alarm_threshold_mgdl from user_settings
 *  26.  elevated-check reads elevated_alarm_threshold_mgdl from user_settings
 *  27.  hyper-check reads high_alarm_threshold_mgdl from user_settings
 *
 * Schema-contract (comparison operators):
 *  28.  hypo-check uses < comparison (value >= threshold → no alarm)
 *  29.  elevated-check uses > comparison (value <= threshold → no alarm)
 *  30.  hyper-check uses > comparison (value <= threshold → no alarm)
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/* ── Pure decision functions ─────────────────────────────────────────────────
 * These mirror the threshold-comparison logic in the Deno Edge Functions.
 * The Edge Function source uses the same expressions — the schema-contract
 * tests below assert that directly.
 * ─────────────────────────────────────────────────────────────────────────── */

const HYPO_DEFAULT_THRESHOLD = 70;
const ELEVATED_DEFAULT_THRESHOLD = 140;
const HYPER_DEFAULT_THRESHOLD = 180;

/**
 * hypo-check: fires when value is BELOW threshold.
 * Source: `if (latestValue >= threshold) { continue; }` → only reaches send
 * when value < threshold.
 */
function shouldFireHypoAlarm(
  valueMgdl: number,
  thresholdMgdl: number | null,
): boolean {
  const threshold = thresholdMgdl ?? HYPO_DEFAULT_THRESHOLD;
  return valueMgdl < threshold;
}

/**
 * elevated-check: fires when value is ABOVE threshold.
 * Source: `if (latestValue <= threshold) { continue; }` → only reaches send
 * when value > threshold.
 */
function shouldFireElevatedAlarm(
  valueMgdl: number,
  thresholdMgdl: number | null,
): boolean {
  const threshold = thresholdMgdl ?? ELEVATED_DEFAULT_THRESHOLD;
  return valueMgdl > threshold;
}

/**
 * hyper-check: fires when value is ABOVE threshold.
 * Source: `if (latestValue <= threshold) { continue; }` → only reaches send
 * when value > threshold.
 */
function shouldFireHyperAlarm(
  valueMgdl: number,
  thresholdMgdl: number | null,
): boolean {
  const threshold = thresholdMgdl ?? HYPER_DEFAULT_THRESHOLD;
  return valueMgdl > threshold;
}

/* ── Source-file reader helpers ──────────────────────────────────────────── */

const FUNCTIONS_DIR = path.resolve(__dirname, "../../supabase/functions");

function readHypoCheck(): string {
  return fs.readFileSync(path.join(FUNCTIONS_DIR, "hypo-check/index.ts"), "utf-8");
}

function readElevatedCheck(): string {
  return fs.readFileSync(path.join(FUNCTIONS_DIR, "elevated-check/index.ts"), "utf-8");
}

function readHyperCheck(): string {
  return fs.readFileSync(path.join(FUNCTIONS_DIR, "hyper-check/index.ts"), "utf-8");
}

/* ── Hypo-check threshold tests ──────────────────────────────────────────── */

test("hypo-check: value one below default threshold (69 < 70) → fires", () => {
  expect(shouldFireHypoAlarm(69, 70)).toBe(true);
});

test("hypo-check: value at default threshold (70 = 70) → no fire (boundary)", () => {
  expect(shouldFireHypoAlarm(70, 70)).toBe(false);
});

test("hypo-check: value one above default threshold (71 > 70) → no fire", () => {
  expect(shouldFireHypoAlarm(71, 70)).toBe(false);
});

test("hypo-check: custom threshold 60 — value one below (59) → fires", () => {
  expect(shouldFireHypoAlarm(59, 60)).toBe(true);
});

test("hypo-check: custom threshold 60 — value at threshold (60) → no fire (boundary)", () => {
  expect(shouldFireHypoAlarm(60, 60)).toBe(false);
});

test("hypo-check: custom threshold 60 — value one above (61) → no fire", () => {
  expect(shouldFireHypoAlarm(61, 60)).toBe(false);
});

test("hypo-check: null threshold falls back to default 70", () => {
  expect(shouldFireHypoAlarm(69, null)).toBe(true);
  expect(shouldFireHypoAlarm(70, null)).toBe(false);
});

/* ── Elevated-check threshold tests ─────────────────────────────────────── */

test("elevated-check: value one above default threshold (141 > 140) → fires", () => {
  expect(shouldFireElevatedAlarm(141, 140)).toBe(true);
});

test("elevated-check: value at default threshold (140 = 140) → no fire (boundary)", () => {
  expect(shouldFireElevatedAlarm(140, 140)).toBe(false);
});

test("elevated-check: value one below default threshold (139 < 140) → no fire", () => {
  expect(shouldFireElevatedAlarm(139, 140)).toBe(false);
});

test("elevated-check: custom threshold 150 — value one above (151) → fires", () => {
  expect(shouldFireElevatedAlarm(151, 150)).toBe(true);
});

test("elevated-check: custom threshold 150 — value at threshold (150) → no fire (boundary)", () => {
  expect(shouldFireElevatedAlarm(150, 150)).toBe(false);
});

test("elevated-check: custom threshold 150 — value one below (149) → no fire", () => {
  expect(shouldFireElevatedAlarm(149, 150)).toBe(false);
});

test("elevated-check: null threshold falls back to default 140", () => {
  expect(shouldFireElevatedAlarm(141, null)).toBe(true);
  expect(shouldFireElevatedAlarm(140, null)).toBe(false);
});

/* ── Hyper-check threshold tests ─────────────────────────────────────────── */

test("hyper-check: value one above default threshold (181 > 180) → fires", () => {
  expect(shouldFireHyperAlarm(181, 180)).toBe(true);
});

test("hyper-check: value at default threshold (180 = 180) → no fire (boundary)", () => {
  expect(shouldFireHyperAlarm(180, 180)).toBe(false);
});

test("hyper-check: value one below default threshold (179 < 180) → no fire", () => {
  expect(shouldFireHyperAlarm(179, 180)).toBe(false);
});

test("hyper-check: custom threshold 200 — value one above (201) → fires", () => {
  expect(shouldFireHyperAlarm(201, 200)).toBe(true);
});

test("hyper-check: custom threshold 200 — value at threshold (200) → no fire (boundary)", () => {
  expect(shouldFireHyperAlarm(200, 200)).toBe(false);
});

test("hyper-check: custom threshold 200 — value one below (199) → no fire", () => {
  expect(shouldFireHyperAlarm(199, 200)).toBe(false);
});

test("hyper-check: null threshold falls back to default 180", () => {
  expect(shouldFireHyperAlarm(181, null)).toBe(true);
  expect(shouldFireHyperAlarm(180, null)).toBe(false);
});

/* ── Schema-contract: disabled alarm must never fire ─────────────────────
 * The enabled-flag filter happens at the DB query level: only users with
 * *_alarm_enabled = true are fetched. If this filter is missing, users who
 * turned off their alarm would still receive pushes.
 * ─────────────────────────────────────────────────────────────────────── */

test("schema-contract: hypo-check filters on low_alarm_enabled = true (disabled alarm never fires)", () => {
  const src = readHypoCheck();
  expect(src).toContain('.eq("low_alarm_enabled", true)');
});

test("schema-contract: elevated-check filters on elevated_alarm_enabled = true (disabled alarm never fires)", () => {
  const src = readElevatedCheck();
  expect(src).toContain('.eq("elevated_alarm_enabled", true)');
});

test("schema-contract: hyper-check filters on high_alarm_enabled = true (disabled alarm never fires)", () => {
  const src = readHyperCheck();
  expect(src).toContain('.eq("high_alarm_enabled", true)');
});

/* ── Schema-contract: threshold column names ─────────────────────────────
 * Verifies each function selects the correct threshold column from
 * user_settings. A column rename without updating the Edge Function would
 * silently fall back to the hardcoded default, ignoring user preferences.
 * ─────────────────────────────────────────────────────────────────────── */

test("schema-contract: hypo-check selects low_alarm_threshold_mgdl from user_settings", () => {
  const src = readHypoCheck();
  expect(src).toContain("low_alarm_threshold_mgdl");
  expect(src).toContain('.from("user_settings")');
  // Column must appear in the select clause, not just be referenced elsewhere
  expect(src).toContain('"user_id, low_alarm_threshold_mgdl"');
});

test("schema-contract: elevated-check selects elevated_alarm_threshold_mgdl from user_settings", () => {
  const src = readElevatedCheck();
  expect(src).toContain("elevated_alarm_threshold_mgdl");
  expect(src).toContain('.from("user_settings")');
  expect(src).toContain('"user_id, elevated_alarm_threshold_mgdl"');
});

test("schema-contract: hyper-check selects high_alarm_threshold_mgdl from user_settings", () => {
  const src = readHyperCheck();
  expect(src).toContain("high_alarm_threshold_mgdl");
  expect(src).toContain('.from("user_settings")');
  expect(src).toContain('"user_id, high_alarm_threshold_mgdl"');
});

/* ── Schema-contract: comparison operators ───────────────────────────────
 * Verifies the correct comparison direction:
 *   - hypo-check must suppress when value >= threshold  (fires only below)
 *   - elevated-check must suppress when value <= threshold (fires only above)
 *   - hyper-check must suppress when value <= threshold (fires only above)
 *
 * The source uses early-continue guards before the send block.
 * ─────────────────────────────────────────────────────────────────────── */

test("schema-contract: hypo-check suppresses alarm when latestValue >= threshold (< is the fire condition)", () => {
  const src = readHypoCheck();
  // The guard reads: if (latestValue >= threshold) { ... continue; }
  expect(src).toContain("latestValue >= threshold");
  // Must NOT have a <= guard (that would be the wrong direction)
  expect(src).not.toContain("latestValue <= threshold");
});

test("schema-contract: elevated-check suppresses alarm when latestValue <= threshold (> is the fire condition)", () => {
  const src = readElevatedCheck();
  // The guard reads: if (latestValue <= threshold) { ... continue; }
  expect(src).toContain("latestValue <= threshold");
  // Must NOT have a >= guard (that would fire on hypo values)
  expect(src).not.toContain("latestValue >= threshold");
});

test("schema-contract: hyper-check suppresses alarm when latestValue <= threshold (> is the fire condition)", () => {
  const src = readHyperCheck();
  // The guard reads: if (latestValue <= threshold) { ... continue; }
  expect(src).toContain("latestValue <= threshold");
  // Must NOT have a >= guard (that would fire on hypo values)
  expect(src).not.toContain("latestValue >= threshold");
});
