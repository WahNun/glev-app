// tests/unit/criticalAlertsUX.test.ts
//
// Phase B + C — Critical Alerts iOS-Code-Prep + UX regression tests.
//
// Covers:
//   1. Entitlement file contains critical-alerts key
//   2. Swift plugin file exists with correct method names
//   3. lib/criticalAlerts.ts exports required functions
//   4. Onboarding step file exists with correct step number and i18n keys
//   5. Onboarding page.tsx references the new step at position 7
//   6. _shared.tsx STEP_COUNT updated to 9
//   7. sensor-alarme settings page imports criticalAlerts and has toggle
//   8. DE + EN i18n keys present for critical_alerts section
//   9. Snooze logic constants are defined

import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ENTITLEMENTS = readFileSync(join(process.cwd(), "ios/App/App/App.entitlements"), "utf8");
const SWIFT_PLUGIN  = join(process.cwd(), "ios/App/App/GlevCriticalAlertsPlugin.swift");
const LIB           = readFileSync(join(process.cwd(), "lib/criticalAlerts.ts"), "utf8");
const ONBOARDING    = readFileSync(join(process.cwd(), "app/onboarding/page.tsx"), "utf8");
const SHARED        = readFileSync(join(process.cwd(), "app/onboarding/_shared.tsx"), "utf8");
const SETTINGS      = readFileSync(join(process.cwd(), "app/(protected)/settings/sensor-alarme/page.tsx"), "utf8");
const DE            = readFileSync(join(process.cwd(), "messages/de.json"), "utf8");
const EN            = readFileSync(join(process.cwd(), "messages/en.json"), "utf8");

// ── 1. Entitlement ────────────────────────────────────────────────────────────

test("App.entitlements: contains critical-alerts entitlement key", () => {
  expect(ENTITLEMENTS).toContain("com.apple.developer.usernotifications.critical-alerts");
  expect(ENTITLEMENTS).toContain("<true/>");
});

// ── 2. Swift plugin file ──────────────────────────────────────────────────────

test("GlevCriticalAlertsPlugin.swift: file exists", () => {
  expect(existsSync(SWIFT_PLUGIN)).toBe(true);
});

test("GlevCriticalAlertsPlugin.swift: exposes requestPermission and checkPermission", () => {
  const src = readFileSync(SWIFT_PLUGIN, "utf8");
  expect(src).toContain("requestPermission");
  expect(src).toContain("checkPermission");
  expect(src).toContain("UNAuthorizationOptionCriticalAlert");
  // Must use .criticalAlert option (not just .alert)
  expect(src).toContain(".criticalAlert");
  expect(src).toContain("CAPPlugin");
  expect(src).toContain("CAPBridgedPlugin");
});

// ── 3. lib/criticalAlerts.ts exports ─────────────────────────────────────────

test("lib/criticalAlerts.ts: exports requestCriticalAlertPermission", () => {
  expect(LIB).toContain("export async function requestCriticalAlertPermission");
});

test("lib/criticalAlerts.ts: exports saveCriticalAlertsEnabled", () => {
  expect(LIB).toContain("export async function saveCriticalAlertsEnabled");
});

test("lib/criticalAlerts.ts: exports fetchCriticalAlertsEnabled", () => {
  expect(LIB).toContain("export async function fetchCriticalAlertsEnabled");
});

test("lib/criticalAlerts.ts: exports checkCriticalAlertPermission", () => {
  expect(LIB).toContain("export async function checkCriticalAlertPermission");
});

test("lib/criticalAlerts.ts: snooze constants defined", () => {
  expect(LIB).toContain("CRITICAL_ALERTS_SNOOZE_KEY");
  expect(LIB).toContain("CRITICAL_ALERTS_SNOOZE_DAYS");
  expect(LIB).toContain("snoozeCriticalAlertsPrompt");
  expect(LIB).toContain("isCriticalAlertsPromptSnoozed");
});

test("lib/criticalAlerts.ts: registers GlevCriticalAlerts plugin with web fallback", () => {
  expect(LIB).toContain('registerPlugin');
  expect(LIB).toContain('"GlevCriticalAlerts"');
  // Web fallback returns false
  expect(LIB).toContain("granted: false");
});

// ── 4. Onboarding step component ─────────────────────────────────────────────

test("app/onboarding/critical-alerts.tsx: exists with correct step number", () => {
  const path = join(process.cwd(), "app/onboarding/critical-alerts.tsx");
  expect(existsSync(path)).toBe(true);
  const src = readFileSync(path, "utf8");
  expect(src).toContain("STEP: Step = 7");
  expect(src).toContain("requestCriticalAlertPermission");
  expect(src).toContain("snoozeCriticalAlertsPrompt");
});

// ── 5. Onboarding page.tsx wires step 7 ──────────────────────────────────────

test("onboarding page.tsx: imports CriticalAlertsStep and renders at step 7", () => {
  expect(ONBOARDING).toContain("CriticalAlertsStep");
  expect(ONBOARDING).toContain("step === 7");
  expect(ONBOARDING).toContain("Math.min(8,");
  // Step 8 is the final step
  expect(ONBOARDING).toContain("step >= 8");
});

// ── 6. _shared.tsx STEP_COUNT ────────────────────────────────────────────────

test("onboarding _shared.tsx: STEP_COUNT is 9 (added critical-alerts step)", () => {
  expect(SHARED).toContain("STEP_COUNT = 9");
  expect(SHARED).toContain("0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8");
});

// ── 7. Settings toggle ────────────────────────────────────────────────────────

test("sensor-alarme/page.tsx: imports criticalAlerts functions", () => {
  expect(SETTINGS).toContain("fetchCriticalAlertsEnabled");
  expect(SETTINGS).toContain("saveCriticalAlertsEnabled");
  expect(SETTINGS).toContain("requestCriticalAlertPermission");
  expect(SETTINGS).toContain("checkCriticalAlertPermission");
});

test("sensor-alarme/page.tsx: has handleCriticalToggle and criticalEnabled state", () => {
  expect(SETTINGS).toContain("criticalEnabled");
  expect(SETTINGS).toContain("handleCriticalToggle");
  expect(SETTINGS).toContain("role=\"switch\"");
  expect(SETTINGS).toContain("iosPermissionMissing");
});

// ── 8. i18n keys ──────────────────────────────────────────────────────────────

test("de.json: critical_alerts onboarding section present", () => {
  const deObj = JSON.parse(DE);
  const section = deObj?.onboarding?.critical_alerts;
  expect(section).toBeTruthy();
  expect(section.headline).toBeTruthy();
  expect(section.activate_btn).toBeTruthy();
  expect(section.later_btn).toBeTruthy();
  expect(section.fine_print).toBeTruthy();
  expect(section.bullet_hypo_title).toBeTruthy();
  expect(section.bullet_hyper_title).toBeTruthy();
  expect(section.bullet_control_title).toBeTruthy();
});

test("en.json: critical_alerts onboarding section present", () => {
  const enObj = JSON.parse(EN);
  const section = enObj?.onboarding?.critical_alerts;
  expect(section).toBeTruthy();
  expect(section.headline).toBeTruthy();
  expect(section.activate_btn).toBeTruthy();
  expect(section.later_btn).toBeTruthy();
});

// ── 9. iOS permission: requestPermission uses .criticalAlert only ──────────────

test("Swift plugin: requestPermission requests ONLY .criticalAlert (not .alert/.badge)", () => {
  const src = readFileSync(SWIFT_PLUGIN, "utf8");
  // The requestPermission method body should only request .criticalAlert
  const methodStart = src.indexOf("func requestPermission");
  const methodEnd   = src.indexOf("func checkPermission");
  const methodBody  = src.slice(methodStart, methodEnd);
  expect(methodBody).toContain(".criticalAlert");
  // Must NOT also request .alert/.badge/.sound (those are in the normal push flow)
  expect(methodBody).not.toContain(".alert,");
  expect(methodBody).not.toContain(".badge,");
});
