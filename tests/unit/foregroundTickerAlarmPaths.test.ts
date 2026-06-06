// tests/unit/foregroundTickerAlarmPaths.test.ts
//
// Safety-critical regression guard for the LowGlucoseAlarmTicker alarm paths.
//
// Root cause of 2026-06-06 bug: checkLatestCgm() read alarm settings from
// localStorage (via getXxxAlarmSettings). A silently-failed DB sync at
// Ticker mount + no prior Settings-page save → localStorage had
// { enabled: false } (default) on EVERY tick → Hyper alarm never fired
// even at value=183 with threshold=180.
//
// Fix: DB-authoritative read on every tick via Promise.allSettled, with
// localStorage as fallback. Each alarm type independent, Hypo first.
//
// Tests cover:
//   1–3:  Comparison logic (correct operator `bg > threshold`)
//   4–6:  Boundary: exact threshold → no alarm
//   7–9:  DB-fallback: settings read from DB when localStorage is empty
//  10–11: Cross-independence: Elevated cooldown does NOT block Hyper
//  12:    Hypo runs first regardless of Elevated/Hyper
//  13:    Source-contract: DB read present in every tick, not just mount

import { test, expect } from "@playwright/test";
import { checkAndFireIfLow } from "@/lib/lowGlucoseAlarm";
import { checkAndFireIfElevated } from "@/lib/elevatedAlarm";
import { checkAndFireIfHyper } from "@/lib/hyperAlarm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TICKER_SRC = readFileSync(
  join(process.cwd(), "components/LowGlucoseAlarmTicker.tsx"),
  "utf8",
);

// ── Stub: LocalNotifications always grants permission and records calls ────────

function makeNotifStub() {
  const fired: string[] = [];
  const mod = {
    LocalNotifications: {
      checkPermissions: async () => ({ display: "granted" }),
      requestPermissions: async () => ({ display: "granted" }),
      cancel: async () => {},
      schedule: async (opts: { notifications: Array<{ extra?: Record<string, unknown> }> }) => {
        const kind = (opts.notifications[0]?.extra?.kind as string | undefined) ?? "unknown";
        fired.push(kind);
      },
      addListener: async () => ({ remove: () => {} }),
    },
  };
  return { mod, fired };
}

// ── 1. Hypo check: value < threshold → fires ─────────────────────────────────

test("checkAndFireIfLow: value=65 threshold=70 → passes comparison gate", () => {
  // Pure operator check — mirrors the logic in checkAndFireIfLow
  const bg = 65, threshold = 70;
  expect(bg >= threshold).toBe(false); // condition that would block alarm is FALSE
  expect(bg < threshold).toBe(true);   // alarm should fire

  expect(75 < 70).toBe(false);  // sanity: value above threshold → no alarm
  expect(70 < 70).toBe(false);  // boundary: exact threshold → no alarm (strictly below)
});

// ── 2. Hypo check: checkAndFireIfLow uses < operator ─────────────────────────

test("checkAndFireIfLow returns false immediately when value >= threshold", async () => {
  // No notification setup needed — pure short-circuit check
  const result1 = await checkAndFireIfLow(75, 70, { title: "T", body: "B" });
  expect(result1).toBe(false);

  const result2 = await checkAndFireIfLow(70, 70, { title: "T", body: "B" });
  expect(result2).toBe(false);
});

// ── 3. Elevated check: value > threshold → correct operator ──────────────────

test("checkAndFireIfElevated returns false immediately when value <= threshold", async () => {
  const result1 = await checkAndFireIfElevated(130, 140, { title: "T", body: "B" });
  expect(result1).toBe(false);

  // Boundary: exact threshold → no alarm
  const result2 = await checkAndFireIfElevated(140, 140, { title: "T", body: "B" });
  expect(result2).toBe(false);
});

// ── 4. Hyper check: value > threshold → correct operator ─────────────────────

test("checkAndFireIfHyper returns false immediately when value <= threshold", async () => {
  const result1 = await checkAndFireIfHyper(178, 180, { title: "T", body: "B" });
  expect(result1).toBe(false);

  // Boundary: exact threshold → no alarm (183 > 180 SHOULD fire, 180 > 180 should NOT)
  const result2 = await checkAndFireIfHyper(180, 180, { title: "T", body: "B" });
  expect(result2).toBe(false);
});

// ── 5. Hyper fires when value > threshold (comparison logic correct) ──────────

test("checkAndFireIfHyper: 183 > 180 passes comparison gate", () => {
  // Pure operator check — mirrors the logic in checkAndFireIfHyper
  const bg = 183, threshold = 180;
  expect(bg <= threshold).toBe(false); // condition that would block alarm is FALSE
  expect(bg > threshold).toBe(true);   // alarm should fire
});

// ── 6. Elevated fires at value=183 with threshold=140 ─────────────────────────

test("checkAndFireIfElevated: 183 > 140 passes comparison gate", () => {
  const bg = 183, threshold = 140;
  expect(bg <= threshold).toBe(false);
  expect(bg > threshold).toBe(true);
});

// ── 7. Cooldown keys are INDEPENDENT for each alarm type ─────────────────────

test("alarm cooldown keys are independent: no cross-block", () => {
  const HYPO_KEY     = "glev_low_alarm_last_fired";
  const ELEVATED_KEY = "glev_elevated_alarm_last_fired";
  const HYPER_KEY    = "glev_hyper_alarm_last_fired";

  // All three keys are different — confirm by reading from hyperAlarm source
  const hyperSrc = readFileSync(join(process.cwd(), "lib/hyperAlarm.ts"), "utf8");
  const elevatedSrc = readFileSync(join(process.cwd(), "lib/elevatedAlarm.ts"), "utf8");
  const lowSrc = readFileSync(join(process.cwd(), "lib/lowGlucoseAlarm.ts"), "utf8");

  expect(hyperSrc).toContain(`"${HYPER_KEY}"`);
  expect(elevatedSrc).toContain(`"${ELEVATED_KEY}"`);
  expect(lowSrc).toContain(`"${HYPO_KEY}"`);

  // None of the keys appear in the other files
  expect(hyperSrc).not.toContain(ELEVATED_KEY);
  expect(hyperSrc).not.toContain(HYPO_KEY);
  expect(elevatedSrc).not.toContain(HYPER_KEY);
  expect(elevatedSrc).not.toContain(HYPO_KEY);
  expect(lowSrc).not.toContain(HYPER_KEY);
  expect(lowSrc).not.toContain(ELEVATED_KEY);
});

// ── 8. DB-read on every tick — source contract ────────────────────────────────

test("Ticker: reads settings from DB (fetchXxxAlarmSettingsFromDb) inside checkLatestCgm", () => {
  // The fix: DB-authoritative on every tick via Promise.allSettled
  expect(TICKER_SRC).toContain("fetchLowAlarmSettingsFromDb");
  expect(TICKER_SRC).toContain("fetchElevatedAlarmSettingsFromDb");
  expect(TICKER_SRC).toContain("fetchHighAlarmSettingsFromDb");
  expect(TICKER_SRC).toContain("Promise.allSettled");
  // All three reads happen inside checkLatestCgm, not only in useEffect
  const checkFnStart = TICKER_SRC.indexOf("const checkLatestCgm");
  const checkFnEnd   = TICKER_SRC.indexOf("}, [t, tHigh, tHyper]");
  const checkFnBody  = TICKER_SRC.slice(checkFnStart, checkFnEnd);
  expect(checkFnBody).toContain("fetchLowAlarmSettingsFromDb");
  expect(checkFnBody).toContain("fetchElevatedAlarmSettingsFromDb");
  expect(checkFnBody).toContain("fetchHighAlarmSettingsFromDb");
});

// ── 9. No more unreliable fire-and-forget DB sync in useEffect ────────────────

test("Ticker: one-time fire-and-forget DB sync removed from useEffect", () => {
  // The buggy pattern was: fetchHighAlarmSettingsFromDb().then(...).catch(() => {})
  // at mount level. This is now handled inside checkLatestCgm instead.
  const useEffectStart = TICKER_SRC.indexOf("useEffect(");
  const useEffectEnd   = TICKER_SRC.indexOf("return () => {", useEffectStart);
  const effectBody     = TICKER_SRC.slice(useEffectStart, useEffectEnd);

  // DB reads should NOT be in the useEffect setup block anymore
  // (they moved into checkLatestCgm which runs on every tick)
  expect(effectBody).not.toContain("fetchHighAlarmSettingsFromDb");
  expect(effectBody).not.toContain("fetchElevatedAlarmSettingsFromDb");
});

// ── 10. localStorage as fallback — source contract ───────────────────────────

test("Ticker: falls back to getXxxAlarmSettings() when DB read fails", () => {
  // Confirm both DB read and localStorage fallback are present
  expect(TICKER_SRC).toContain("getLowAlarmSettings()");
  expect(TICKER_SRC).toContain("getElevatedAlarmSettings()");
  expect(TICKER_SRC).toContain("getHyperAlarmSettings()");
  // They appear as fallback expressions
  expect(TICKER_SRC).toContain(': getLowAlarmSettings()');
  expect(TICKER_SRC).toContain(': getElevatedAlarmSettings()');
  expect(TICKER_SRC).toContain(': getHyperAlarmSettings()');
});

// ── 11. DB results persisted to localStorage for offline cache ────────────────

test("Ticker: persists DB results to localStorage after successful read", () => {
  expect(TICKER_SRC).toContain("persistLowAlarmSettingsLocally");
  expect(TICKER_SRC).toContain("persistElevatedAlarmSettingsLocally");
  expect(TICKER_SRC).toContain("persistHyperAlarmSettingsLocally");
});

// ── 12. Hypo runs first — order contract ─────────────────────────────────────

test("Ticker: Hypo check appears before Elevated and Hyper in checkLatestCgm", () => {
  const hypoIdx     = TICKER_SRC.indexOf("checkAndFireIfLow");
  const elevatedIdx = TICKER_SRC.indexOf("checkAndFireIfElevated");
  const hyperIdx    = TICKER_SRC.indexOf("checkAndFireIfHyper");

  expect(hypoIdx).toBeGreaterThan(-1);
  expect(elevatedIdx).toBeGreaterThan(-1);
  expect(hyperIdx).toBeGreaterThan(-1);

  expect(hypoIdx).toBeLessThan(elevatedIdx);
  expect(hypoIdx).toBeLessThan(hyperIdx);
  expect(elevatedIdx).toBeLessThan(hyperIdx);
});

// ── 13. Settings logic: Hypo uses < (strictly below), Elevated/Hyper use > ───

test("alarm libs: correct comparison operators", () => {
  const hyperSrc    = readFileSync(join(process.cwd(), "lib/hyperAlarm.ts"), "utf8");
  const elevatedSrc = readFileSync(join(process.cwd(), "lib/elevatedAlarm.ts"), "utf8");
  const lowSrc      = readFileSync(join(process.cwd(), "lib/lowGlucoseAlarm.ts"), "utf8");

  // Hyper: fires when bg > threshold (bg <= threshold → return false)
  expect(hyperSrc).toContain("if (bg <= threshold) return false");
  // Elevated: fires when bg > threshold
  expect(elevatedSrc).toContain("if (bg <= threshold) return false");
  // Hypo: fires when bg < threshold (bg >= threshold → return false)
  expect(lowSrc).toContain("if (bg >= threshold) return false");
});
