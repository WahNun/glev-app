// tests/unit/criticalAlertsEnforcement.test.ts
//
// Phase A — Critical Alerts server-side enforcement regression tests.
//
// These are source-contract tests: they verify that the edge function source
// files contain the correct logic patterns for critical-alert enforcement.
// Deno edge functions cannot be imported into Node.js/Playwright tests, so
// we read the source and assert the critical patterns exist.
//
// Covers:
//   1. hypo-check: notif_critical_alerts read from DB
//   2. hypo-check: interruption-level = "critical" when flag=true
//   3. hypo-check: interruption-level = "time-sensitive" when flag=false (push still sent)
//   4. hyper-check: same critical/time-sensitive conditional
//   5. elevated-check: ALWAYS time-sensitive, never critical
//   6. All functions: debug log line present
//   7. NULL → false conservative default for all functions
//   8. Cooldown logic unchanged (not overridden by new code)

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HYPO    = readFileSync(join(process.cwd(), "supabase/functions/hypo-check/index.ts"),     "utf8");
const HYPER   = readFileSync(join(process.cwd(), "supabase/functions/hyper-check/index.ts"),    "utf8");
const ELEVATED = readFileSync(join(process.cwd(), "supabase/functions/elevated-check/index.ts"),"utf8");

// ── 1. hypo-check: notif_critical_alerts in DB query ─────────────────────────

test("hypo-check: queries notif_critical_alerts from user_settings", () => {
  expect(HYPO).toContain("notif_critical_alerts");
  // Must be part of the SELECT string, not just a comment
  expect(HYPO).toContain("low_alarm_threshold_mgdl, notif_critical_alerts");
});

// ── 2. hypo-check: critical interruption-level when flag=true ────────────────

test("hypo-check: sets interruption-level to critical when notif_critical_alerts=true", () => {
  // criticalByUserId map must be built
  expect(HYPO).toContain("criticalByUserId");
  expect(HYPO).toContain("notif_critical_alerts === true");
  // interruptionLevel variable computed with conditional
  expect(HYPO).toContain("interruptionLevel");
  expect(HYPO).toContain(`criticalEnabled ? "critical" : "time-sensitive"`);
  // Must be passed to sendApnsPush
  expect(HYPO).toContain("sendApnsPush(apnsKeyP8, apnsKeyId, apnsTeamId, apnsBundleId, user.push_token, title, body, interruptionLevel)");
});

// ── 3. hypo-check: time-sensitive (but push still sent) when flag=false ──────

test("hypo-check: push sent regardless of flag — only level differs", () => {
  // sendFcmPushV1 and sendApnsPush must both appear in the file (push always happens)
  expect(HYPO).toContain("sendFcmPushV1");
  expect(HYPO).toContain("sendApnsPush");
  // No early-exit guard based on criticalEnabled alone
  expect(HYPO).not.toContain("!criticalEnabled) continue");
  expect(HYPO).not.toContain("!criticalEnabled) { continue");
  expect(HYPO).not.toContain("if (!criticalEnabled)");
});

// ── 4. hyper-check: conditional critical/time-sensitive ──────────────────────

test("hyper-check: queries notif_critical_alerts from user_settings", () => {
  expect(HYPER).toContain("notif_critical_alerts");
  expect(HYPER).toContain("high_alarm_threshold_mgdl, notif_critical_alerts");
});

test("hyper-check: sets interruption-level to critical when notif_critical_alerts=true", () => {
  expect(HYPER).toContain("criticalByUserId");
  expect(HYPER).toContain("notif_critical_alerts === true");
  expect(HYPER).toContain(`criticalEnabled ? "critical" : "time-sensitive"`);
  expect(HYPER).toContain("sendApnsPush(apnsKeyP8, apnsKeyId, apnsTeamId, apnsBundleId, user.push_token, title, body, interruptionLevel)");
});

// ── 5. elevated-check: ALWAYS time-sensitive, NEVER critical ─────────────────

test("elevated-check: queries notif_critical_alerts (for logging parity)", () => {
  expect(ELEVATED).toContain("notif_critical_alerts");
});

test('elevated-check: interruptionLevel is hardcoded to "time-sensitive" — never critical', () => {
  // Must contain the hardcoded constant
  expect(ELEVATED).toContain(`interruptionLevel = "time-sensitive" as const`);
  // Must NOT contain a conditional assigning "critical"
  expect(ELEVATED).not.toContain(`? "critical"`);
  expect(ELEVATED).not.toContain(`"interruption-level": "critical"`);
});

// ── 6. All functions: debug log line ─────────────────────────────────────────

test("hypo-check: logs critical_pref and level before dispatch", () => {
  expect(HYPO).toContain("critical_pref=");
  expect(HYPO).toContain("level=");
});

test("hyper-check: logs critical_pref and level before dispatch", () => {
  expect(HYPER).toContain("critical_pref=");
  expect(HYPER).toContain("level=");
});

test("elevated-check: logs critical_pref and level (always time-sensitive)", () => {
  expect(ELEVATED).toContain("critical_pref=");
  expect(ELEVATED).toContain("level=");
});

// ── 7. NULL → false conservative default ─────────────────────────────────────

test("hypo-check: NULL notif_critical_alerts defaults to false (conservative)", () => {
  // criticalByUserId uses === true (strict), so null → false
  expect(HYPO).toContain("notif_critical_alerts === true");
  // UserEntry construction falls back to false
  expect(HYPO).toContain("criticalByUserId.get(r.user_id) ?? false");
});

test("hyper-check: NULL notif_critical_alerts defaults to false (conservative)", () => {
  expect(HYPER).toContain("notif_critical_alerts === true");
  expect(HYPER).toContain("criticalByUserId.get(r.user_id) ?? false");
});

// ── 8. Cooldown logic unchanged ───────────────────────────────────────────────

test("hypo-check: cooldown check still happens before critical-level computation", () => {
  const cooldownIdx     = HYPO.indexOf("cooldownCutoff");
  const criticalIdx     = HYPO.indexOf("criticalEnabled");
  // cooldown guard appears before the critical-level decision
  expect(cooldownIdx).toBeGreaterThan(-1);
  expect(criticalIdx).toBeGreaterThan(-1);
  expect(cooldownIdx).toBeLessThan(criticalIdx);
});

test("hyper-check: cooldown check still happens before critical-level computation", () => {
  const cooldownIdx = HYPER.indexOf("cooldownCutoff");
  const criticalIdx = HYPER.indexOf("criticalEnabled");
  expect(cooldownIdx).toBeGreaterThan(-1);
  expect(criticalIdx).toBeGreaterThan(-1);
  expect(cooldownIdx).toBeLessThan(criticalIdx);
});
