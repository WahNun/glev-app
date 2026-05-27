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
//   4. buildContextPayload() — request body construction (lib/useGlevAI):
//      - Tests the pure helper that fills every contextSnapshot field
//        with NEUTRAL when the field is undefined/missing.
//      - Verifies glucoseSummary, iobSummary, and lastMealDescription
//        all receive the sentinel without requiring mocked fetch or
//        React hooks.
//
//   5. buildScreenContext() — context output shape:
//      - Verifies that a null glucose (returned when wantsGlucose=false)
//        produces glucoseSummary: undefined in the ScreenContext object.
//      - This closes the loop on the consent-null → glucoseSummary
//        absent requirement.
//
// All tests import only from lib/ — no React, no next/navigation, no
// browser dependency.

import { test, expect } from "@playwright/test";
import {
  pathToScreen,
  resolveWants,
  getIOBSummary,
  buildScreenContext,
  type InsulinLogRow,
} from "@/lib/screenContext";
import { buildContextPayload, __test__ as glevAITest } from "@/lib/useGlevAI";

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
// 4. buildContextPayload() — /api/ai/chat request body construction
//    (lib/useGlevAI.ts — the same function used inside sendMessage())
// ─────────────────────────────────────────────────────────────────────────────

test("NEUTRAL constant is 'Keine Daten verfügbar'", () => {
  expect(glevAITest.NEUTRAL).toBe("Keine Daten verfügbar");
});

test("buildContextPayload: glucoseSummary falls back to NEUTRAL when undefined", () => {
  // No glucoseSummary in snapshot → AI request body must receive NEUTRAL
  const payload = buildContextPayload({ screen: "dashboard" });
  expect(payload.glucoseSummary).toBe(glevAITest.NEUTRAL);
});

test("buildContextPayload: iobSummary falls back to NEUTRAL when undefined", () => {
  const payload = buildContextPayload({ screen: "engine" });
  expect(payload.iobSummary).toBe(glevAITest.NEUTRAL);
});

test("buildContextPayload: lastMealDescription falls back to NEUTRAL when undefined", () => {
  const payload = buildContextPayload({ screen: "dashboard" });
  expect(payload.lastMealDescription).toBe(glevAITest.NEUTRAL);
});

test("buildContextPayload: lastMealDescription prefers lastMealSummary over lastMealDescription alias", () => {
  const payload = buildContextPayload({
    screen: "dashboard",
    lastMealSummary: "Pasta 60g KH",
    lastMealDescription: "stale alias",
  });
  expect(payload.lastMealDescription).toBe("Pasta 60g KH");
});

test("buildContextPayload: present values are passed through unchanged", () => {
  const payload = buildContextPayload({
    screen: "dashboard",
    glucoseSummary: "142 mg/dL ↗, vor 4 min",
    iobSummary: "≈ 3.2 IE aktiv",
    lastMealSummary: "Pasta 60g KH",
  });
  expect(payload.screen).toBe("dashboard");
  expect(payload.glucoseSummary).toBe("142 mg/dL ↗, vor 4 min");
  expect(payload.iobSummary).toBe("≈ 3.2 IE aktiv");
  expect(payload.lastMealDescription).toBe("Pasta 60g KH");
});

test("buildContextPayload: no snapshot at all → all three fields are NEUTRAL", () => {
  const payload = buildContextPayload(undefined);
  expect(payload.glucoseSummary).toBe(glevAITest.NEUTRAL);
  expect(payload.iobSummary).toBe(glevAITest.NEUTRAL);
  expect(payload.lastMealDescription).toBe(glevAITest.NEUTRAL);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. buildScreenContext() — consent-null → glucoseSummary: undefined
//    Verifies the full pipeline: resolveWants() returns wantsGlucose=false
//    → glucose fetch skipped → null passed to buildScreenContext()
//    → glucoseSummary absent from the returned ScreenContext object.
// ─────────────────────────────────────────────────────────────────────────────

test("buildScreenContext: null glucoseSummary → glucoseSummary is undefined in output", () => {
  // Simulate consent-null path: resolveWants returns wantsGlucose=false,
  // so getGlucoseSummary() is never called and the glucose value is null.
  const { wantsGlucose } = resolveWants("dashboard", {
    ai_consent_glucose_at: null,
    ai_consent_iob_at: null,
  });
  expect(wantsGlucose).toBe(false); // guard: consent gating fires

  const ctx = buildScreenContext(
    "dashboard",
    wantsGlucose ? "142 mg/dL" : null, // null because consent is absent
    null,
    null,
  );
  expect(ctx.glucoseSummary).toBeUndefined();
});

test("buildScreenContext: null iobSummary → iobSummary is undefined in output", () => {
  const ctx = buildScreenContext("engine", null, null, null);
  expect(ctx.iobSummary).toBeUndefined();
});

test("buildScreenContext: real values are preserved in output ScreenContext", () => {
  const ctx = buildScreenContext(
    "dashboard",
    "142 mg/dL ↗, vor 4 min",
    "≈ 3.2 IE aktiv",
    "Pasta 60g KH, vor 35 min",
  );
  expect(ctx.screen).toBe("dashboard");
  expect(ctx.glucoseSummary).toBe("142 mg/dL ↗, vor 4 min");
  expect(ctx.iobSummary).toBe("≈ 3.2 IE aktiv");
  expect(ctx.lastMealSummary).toBe("Pasta 60g KH, vor 35 min");
});
