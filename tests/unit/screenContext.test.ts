// Unit tests for the pure helpers in lib/screenContext.ts
//
// What these tests pin:
//
//   1. pathToScreen() — maps URL prefixes to all 6 GlevScreen values:
//      dashboard, engine, entries, insights, settings, unknown.
//
//   2. resolveWants() — consent gating:
//      - glucoseSummary path is only enabled on dashboard AND when
//        ai_consent_glucose_at is truthy (non-null).
//      - iobSummary path is enabled on dashboard + engine AND when
//        ai_consent_iob_at is truthy.
//      - lastMealSummary path is always enabled on dashboard + entries.
//
//   3. getIOBSummary() — IOB fallback:
//      - Returns "Kein aktiver IOB" when no bolus insulin_logs exist.
//      - Returns "Kein aktiver IOB" when IOB computes to < 0.05 IE
//        (i.e. dose fully decayed).
//      - Returns a formatted string when a recent bolus is active.
//
//   4. NEUTRAL constant from useGlevAI.__test__:
//      - Verifies the sentinel "Keine Daten verfügbar" that the AI
//        request body falls back to when context fields are missing.
//
// All tests import only from lib/ — no React, no next/navigation, no
// browser dependency.

import { test, expect } from "@playwright/test";
import {
  pathToScreen,
  resolveWants,
  getIOBSummary,
  type InsulinLogRow,
} from "@/lib/screenContext";
import { __test__ as glevAITest } from "@/lib/useGlevAI";

// ─────────────────────────────────────────────────────────────────────────────
// Fake Supabase builder factory
// Returns a minimal duck-typed client whose chain resolves per config.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeConfig {
  userSettings?: Record<string, unknown> | null;
  insulinLogs?: InsulinLogRow[];
}

function makeFake(config: FakeConfig = {}) {
  return {
    from(table: string) {
      if (table === "user_settings") {
        return {
          select(_c: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  async maybeSingle() {
                    return { data: config.userSettings ?? null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "insulin_logs") {
        return {
          select(_c: string) {
            return {
              eq(_c1: string, _v1: unknown) {
                return {
                  eq(_c2: string, _v2: unknown) {
                    return {
                      gte(_c3: string, _v3: unknown) {
                        return {
                          async order(_c4: string, _o: { ascending: boolean }) {
                            return {
                              data: config.insulinLogs ?? [],
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      return {};
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. pathToScreen()
// ─────────────────────────────────────────────────────────────────────────────

test("pathToScreen: /dashboard → 'dashboard'", () => {
  expect(pathToScreen("/dashboard")).toBe("dashboard");
});

test("pathToScreen: /dashboard/settings sub-path → 'dashboard'", () => {
  expect(pathToScreen("/dashboard/settings")).toBe("dashboard");
});

test("pathToScreen: /engine → 'engine'", () => {
  expect(pathToScreen("/engine")).toBe("engine");
});

test("pathToScreen: /entries → 'entries'", () => {
  expect(pathToScreen("/entries")).toBe("entries");
});

test("pathToScreen: /insights → 'insights'", () => {
  expect(pathToScreen("/insights")).toBe("insights");
});

test("pathToScreen: /settings → 'settings'", () => {
  expect(pathToScreen("/settings")).toBe("settings");
});

test("pathToScreen: /pro → 'unknown'", () => {
  expect(pathToScreen("/pro")).toBe("unknown");
});

test("pathToScreen: / (root) → 'unknown'", () => {
  expect(pathToScreen("/")).toBe("unknown");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolveWants() — consent gating
// ─────────────────────────────────────────────────────────────────────────────

test("resolveWants: glucoseSummary NOT fetched when ai_consent_glucose_at is null", () => {
  const wants = resolveWants("dashboard", {
    ai_consent_glucose_at: null,
    ai_consent_iob_at:     null,
  });
  expect(wants.wantsGlucose).toBe(false);
});

test("resolveWants: glucoseSummary fetched when ai_consent_glucose_at is set and screen=dashboard", () => {
  const wants = resolveWants("dashboard", {
    ai_consent_glucose_at: "2026-01-01T00:00:00Z",
    ai_consent_iob_at:     null,
  });
  expect(wants.wantsGlucose).toBe(true);
});

test("resolveWants: glucoseSummary NOT fetched even with consent when screen=engine", () => {
  const wants = resolveWants("engine", {
    ai_consent_glucose_at: "2026-01-01T00:00:00Z",
    ai_consent_iob_at:     "2026-01-01T00:00:00Z",
  });
  expect(wants.wantsGlucose).toBe(false);
});

test("resolveWants: iobSummary fetched on dashboard when ai_consent_iob_at is set", () => {
  const wants = resolveWants("dashboard", {
    ai_consent_glucose_at: null,
    ai_consent_iob_at:     "2026-01-01T00:00:00Z",
  });
  expect(wants.wantsIOB).toBe(true);
});

test("resolveWants: iobSummary fetched on engine when ai_consent_iob_at is set", () => {
  const wants = resolveWants("engine", {
    ai_consent_glucose_at: null,
    ai_consent_iob_at:     "2026-01-01T00:00:00Z",
  });
  expect(wants.wantsIOB).toBe(true);
});

test("resolveWants: iobSummary NOT fetched on entries even with consent", () => {
  const wants = resolveWants("entries", {
    ai_consent_glucose_at: null,
    ai_consent_iob_at:     "2026-01-01T00:00:00Z",
  });
  expect(wants.wantsIOB).toBe(false);
});

test("resolveWants: lastMeal fetched on dashboard regardless of consent", () => {
  const wants = resolveWants("dashboard", null);
  expect(wants.wantsMeal).toBe(true);
});

test("resolveWants: lastMeal fetched on entries regardless of consent", () => {
  const wants = resolveWants("entries", null);
  expect(wants.wantsMeal).toBe(true);
});

test("resolveWants: lastMeal NOT fetched on engine", () => {
  const wants = resolveWants("engine", null);
  expect(wants.wantsMeal).toBe(false);
});

test("resolveWants: lastMeal NOT fetched on insights", () => {
  const wants = resolveWants("insights", null);
  expect(wants.wantsMeal).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getIOBSummary() — IOB fallback when no bolus exists
// ─────────────────────────────────────────────────────────────────────────────

test("getIOBSummary: returns 'Kein aktiver IOB' when no bolus logs exist", async () => {
  const sb = makeFake({ userSettings: null, insulinLogs: [] });
  const result = await getIOBSummary(sb, "test-user");
  expect(result).toBe("Kein aktiver IOB");
});

test("getIOBSummary: returns 'Kein aktiver IOB' when insulin_logs is null", async () => {
  const sb = makeFake({ userSettings: null, insulinLogs: undefined });
  const result = await getIOBSummary(sb, "test-user");
  expect(result).toBe("Kein aktiver IOB");
});

test("getIOBSummary: returns active IOB string for a fresh bolus", async () => {
  // Bolus 5 minutes ago, 8 IE — should still have meaningful IOB
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
  const logs: InsulinLogRow[] = [
    { id: "log-1", insulin_type: "bolus", units: 8, created_at: fiveMinutesAgo },
  ];
  const sb = makeFake({
    userSettings: { insulin_type: "rapid", dia_minutes: 180 },
    insulinLogs: logs,
  });
  const result = await getIOBSummary(sb, "test-user");
  // Should start with ≈ and contain "IE aktiv"
  expect(result).not.toBeNull();
  expect(result).toMatch(/≈ \d+\.\d+ IE aktiv/);
});

test("getIOBSummary: returns 'Kein aktiver IOB' for a fully decayed dose (> DIA)", async () => {
  // Bolus 200 minutes ago with rapid (DIA=180min) — fully decayed
  const now = new Date();
  const longAgo = new Date(now.getTime() - 200 * 60_000).toISOString();
  const logs: InsulinLogRow[] = [
    { id: "log-2", insulin_type: "bolus", units: 4, created_at: longAgo },
  ];
  const sb = makeFake({
    userSettings: { insulin_type: "rapid", dia_minutes: 180 },
    insulinLogs: logs,
  });
  const result = await getIOBSummary(sb, "test-user");
  expect(result).toBe("Kein aktiver IOB");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. NEUTRAL fallback constant from useGlevAI
// ─────────────────────────────────────────────────────────────────────────────

test("NEUTRAL fallback is 'Keine Daten verfügbar'", () => {
  expect(glevAITest.NEUTRAL).toBe("Keine Daten verfügbar");
});

test("NEUTRAL fallback is used when context fields are absent (glucoseSummary undefined)", () => {
  // Simulate the AI request body building: missing field → NEUTRAL
  const contextSnapshot = { screen: "dashboard" as const };
  const glucoseSummary = (contextSnapshot as Record<string, unknown>).glucoseSummary as string | undefined;
  const resolved = glucoseSummary ?? glevAITest.NEUTRAL;
  expect(resolved).toBe("Keine Daten verfügbar");
});

test("NEUTRAL fallback is used when iobSummary is undefined", () => {
  const contextSnapshot = { screen: "dashboard" as const };
  const iobSummary = (contextSnapshot as Record<string, unknown>).iobSummary as string | undefined;
  const resolved = iobSummary ?? glevAITest.NEUTRAL;
  expect(resolved).toBe("Keine Daten verfügbar");
});
