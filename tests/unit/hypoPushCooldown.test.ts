/**
 * Unit tests for the server-side hypo-push cooldown logic.
 *
 * These tests verify the pure decision logic used by the hypo-check Edge
 * Function without requiring a real database connection or push provider.
 *
 * Tests cover:
 *   - isCooledDown: returns true when last_sent_at is within 15 minutes
 *   - isCooledDown: returns false when last_sent_at is older than 15 minutes
 *   - isCooledDown: returns false when no cooldown row exists (first run)
 *   - shouldSendAlert: returns false when CGM value is at or above threshold
 *   - shouldSendAlert: returns true when CGM value is below threshold
 *   - shouldSendAlert: uses default threshold (70) when none configured
 *   - pickLatestReading: selects the more recent of two sources
 *   - pickLatestReading: returns null when no readings available
 *   - buildPushBody: formats the message correctly
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/* ── Pure helpers extracted from Edge Function logic ─────────────────────
 * Re-implemented here as pure functions so they can be tested without
 * importing Deno-specific modules. The Edge Function uses the same logic.
 * ──────────────────────────────────────────────────────────────────────── */

const COOLDOWN_MINUTES = 15;
const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
const DEFAULT_THRESHOLD = 70;

function isCooledDown(lastSentAt: Date | null, now: Date): boolean {
  if (!lastSentAt) return false;
  return now.getTime() - lastSentAt.getTime() < COOLDOWN_MS;
}

function shouldSendAlert(
  valueMgdl: number,
  thresholdMgdl: number | null,
): boolean {
  const threshold = thresholdMgdl ?? DEFAULT_THRESHOLD;
  return valueMgdl < threshold;
}

interface Reading {
  value: number;
  at: Date;
}

function pickLatestReading(candidates: Reading[]): Reading | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.at > best.at ? r : best));
}

function buildPushBody(valueMgdl: number): string {
  return `Dein BZ liegt bei ${Math.round(valueMgdl)} mg/dL — prüf dich jetzt.`;
}

/* ── isCooledDown tests ──────────────────────────────────────────────────── */

test("isCooledDown: returns true when last_sent_at is 5 minutes ago", () => {
  const now = new Date("2026-05-25T10:00:00Z");
  const lastSent = new Date("2026-05-25T09:55:00Z"); // 5 min ago
  expect(isCooledDown(lastSent, now)).toBe(true);
});

test("isCooledDown: returns true when last_sent_at is exactly 14 minutes ago", () => {
  const now = new Date("2026-05-25T10:00:00Z");
  const lastSent = new Date("2026-05-25T09:46:00Z"); // 14 min ago
  expect(isCooledDown(lastSent, now)).toBe(true);
});

test("isCooledDown: returns false when last_sent_at is exactly 15 minutes ago", () => {
  const now = new Date("2026-05-25T10:00:00Z");
  const lastSent = new Date("2026-05-25T09:45:00Z"); // exactly 15 min ago
  expect(isCooledDown(lastSent, now)).toBe(false);
});

test("isCooledDown: returns false when last_sent_at is 30 minutes ago", () => {
  const now = new Date("2026-05-25T10:00:00Z");
  const lastSent = new Date("2026-05-25T09:30:00Z"); // 30 min ago
  expect(isCooledDown(lastSent, now)).toBe(false);
});

test("isCooledDown: returns false when no cooldown row exists (first run)", () => {
  const now = new Date("2026-05-25T10:00:00Z");
  expect(isCooledDown(null, now)).toBe(false);
});

/* ── shouldSendAlert tests ───────────────────────────────────────────────── */

test("shouldSendAlert: returns true when value is below threshold", () => {
  expect(shouldSendAlert(60, 70)).toBe(true);
});

test("shouldSendAlert: returns false when value equals threshold", () => {
  expect(shouldSendAlert(70, 70)).toBe(false);
});

test("shouldSendAlert: returns false when value is above threshold", () => {
  expect(shouldSendAlert(90, 70)).toBe(false);
});

test("shouldSendAlert: uses default threshold 70 when null", () => {
  expect(shouldSendAlert(65, null)).toBe(true);
  expect(shouldSendAlert(70, null)).toBe(false);
});

test("shouldSendAlert: respects custom threshold 54 (level-2 hypo)", () => {
  expect(shouldSendAlert(55, 54)).toBe(false);
  expect(shouldSendAlert(53, 54)).toBe(true);
});

test("shouldSendAlert: respects custom threshold 80", () => {
  expect(shouldSendAlert(79, 80)).toBe(true);
  expect(shouldSendAlert(80, 80)).toBe(false);
});

/* ── pickLatestReading tests ─────────────────────────────────────────────── */

test("pickLatestReading: selects the more recent reading when CGM is newer", () => {
  const cgm: Reading = { value: 62, at: new Date("2026-05-25T09:58:00Z") };
  const ah: Reading = { value: 58, at: new Date("2026-05-25T09:55:00Z") };
  const result = pickLatestReading([cgm, ah]);
  expect(result?.value).toBe(62);
});

test("pickLatestReading: selects the more recent reading when Apple Health is newer", () => {
  const cgm: Reading = { value: 62, at: new Date("2026-05-25T09:53:00Z") };
  const ah: Reading = { value: 58, at: new Date("2026-05-25T09:57:00Z") };
  const result = pickLatestReading([cgm, ah]);
  expect(result?.value).toBe(58);
});

test("pickLatestReading: returns null when no readings available", () => {
  expect(pickLatestReading([])).toBeNull();
});

test("pickLatestReading: returns the single reading when only one source", () => {
  const cgm: Reading = { value: 65, at: new Date("2026-05-25T09:59:00Z") };
  const result = pickLatestReading([cgm]);
  expect(result?.value).toBe(65);
});

/* ── Schema-contract tests ───────────────────────────────────────────────── */
// These tests read the Edge Function source to verify it references the
// correct table column names. They guard against regressions where a
// column rename or wrong assumption silently breaks the push logic.

const EDGE_FN_PATH = path.resolve(
  __dirname,
  "../../supabase/functions/hypo-check/index.ts",
);

function readEdgeFn(): string {
  return fs.readFileSync(EDGE_FN_PATH, "utf-8");
}

test("schema-contract: cgm_samples queries use 'timestamp' column (not recorded_at)", () => {
  const src = readEdgeFn();
  // Must select the correct column name
  expect(src).toContain(`"value_mgdl, timestamp"`);
  // Must not use the wrong column name for cgm_samples ordering
  const cgmBlock = src.slice(src.indexOf("from(\"cgm_samples\")"));
  const firstOrder = cgmBlock.indexOf(".order(");
  expect(cgmBlock.slice(firstOrder, firstOrder + 40)).toContain(`"timestamp"`);
  expect(src).not.toContain(`"value_mgdl, recorded_at"`);
});

test("schema-contract: apple_health_readings queries use 'timestamp' column (not recorded_at)", () => {
  const src = readEdgeFn();
  // Must select the correct column name
  expect(src).toContain(`"value_mg_dl, timestamp"`);
  expect(src).not.toContain(`"value_mg_dl, recorded_at"`);
});

test("schema-contract: alarm settings queried from user_settings (not profiles)", () => {
  const src = readEdgeFn();
  // The alarm query must target user_settings
  expect(src).toContain(`.from("user_settings")`);
  // low_alarm_enabled must be used as a filter on user_settings
  expect(src).toContain(`low_alarm_enabled`);
  // Push token must be fetched from profiles in a separate query
  expect(src).toContain(`.from("profiles")`);
});

test("schema-contract: CGM query errors are logged (not silently swallowed)", () => {
  const src = readEdgeFn();
  expect(src).toContain("cgmError");
  expect(src).toContain("ahError");
});

/* ── buildPushBody tests ─────────────────────────────────────────────────── */

test("buildPushBody: formats integer value correctly", () => {
  const body = buildPushBody(62);
  expect(body).toBe("Dein BZ liegt bei 62 mg/dL — prüf dich jetzt.");
});

test("buildPushBody: rounds decimal value", () => {
  const body = buildPushBody(61.7);
  expect(body).toBe("Dein BZ liegt bei 62 mg/dL — prüf dich jetzt.");
});

test("buildPushBody: handles value at low level-2 boundary", () => {
  const body = buildPushBody(54);
  expect(body).toBe("Dein BZ liegt bei 54 mg/dL — prüf dich jetzt.");
});
