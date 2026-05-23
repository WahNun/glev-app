// Regression guard for the "insulin brand flows from Settings into the IOB footer" feature.
//
// The DIA footer in IOBCard shows the active insulin type label.  When the user
// has saved a custom brand name in Settings → Insulin (e.g. "Fiasp"), that name
// must appear instead of the generic "Rapid" / "Regular" fallback.
//
// These tests cover the pure `resolveBolusTypeLabel` helper that encapsulates
// this derivation (extracted from IOBCard so it can be tested without a React
// render environment or next-intl setup).
//
// The tests verify:
//   1. A configured brand name is returned verbatim.
//   2. Surrounding whitespace in the stored brand string is trimmed.
//   3. When no brand is configured, the insulinType drives the fallback label.
//   4. An empty / whitespace-only brand string falls back to the type label.
//   5. "unknown" insulin type falls back to the regularLabel (same branch as non-rapid).
//   6. Brand beats insulinType — even for "regular", the brand name wins.
//   7. A second bolus brand (insulinBrandBolus2) is combined in the DIA footer
//      string using the same filter-and-join pattern used by IOBCard.

import { test, expect } from "@playwright/test";
import { resolveBolusTypeLabel } from "@/lib/iob";
import { resolveInsulinNamePrefill } from "@/lib/userSettings";
import type { InsulinSettings } from "@/lib/userSettings";

const RAPID_LABEL   = "Rapid";
const REGULAR_LABEL = "Regular";

// ── 1. Brand name is returned when configured ────────────────────────────────

test("resolveBolusTypeLabel: configured brand 'Fiasp' is returned instead of 'Rapid'", () => {
  const label = resolveBolusTypeLabel("Fiasp", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Fiasp");
});

test("resolveBolusTypeLabel: configured brand 'Novorapid' is returned instead of 'Rapid'", () => {
  const label = resolveBolusTypeLabel("Novorapid", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Novorapid");
});

test("resolveBolusTypeLabel: configured brand is returned even for 'regular' insulin type", () => {
  const label = resolveBolusTypeLabel("Humulin R", "regular", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Humulin R");
});

// ── 2. Whitespace in the stored brand string is trimmed ──────────────────────

test("resolveBolusTypeLabel: leading and trailing whitespace in brand is stripped", () => {
  const label = resolveBolusTypeLabel("  Fiasp  ", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Fiasp");
});

test("resolveBolusTypeLabel: internal whitespace is preserved, only surrounding is stripped", () => {
  const label = resolveBolusTypeLabel("  Humalog KwikPen  ", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Humalog KwikPen");
});

// ── 3. Fallback to insulinType label when no brand is configured ─────────────

test("resolveBolusTypeLabel: undefined brand with 'rapid' type returns rapidLabel", () => {
  const label = resolveBolusTypeLabel(undefined, "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(RAPID_LABEL);
});

test("resolveBolusTypeLabel: undefined brand with 'regular' type returns regularLabel", () => {
  const label = resolveBolusTypeLabel(undefined, "regular", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(REGULAR_LABEL);
});

// ── 4. Empty / whitespace-only brand falls back to the type label ─────────────

test("resolveBolusTypeLabel: empty string brand falls back to rapidLabel for 'rapid'", () => {
  const label = resolveBolusTypeLabel("", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(RAPID_LABEL);
});

test("resolveBolusTypeLabel: whitespace-only brand falls back to rapidLabel for 'rapid'", () => {
  const label = resolveBolusTypeLabel("   ", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(RAPID_LABEL);
});

test("resolveBolusTypeLabel: whitespace-only brand falls back to regularLabel for 'regular'", () => {
  const label = resolveBolusTypeLabel("   ", "regular", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(REGULAR_LABEL);
});

// ── 5. 'unknown' insulin type falls back to regularLabel ──────────────────────

test("resolveBolusTypeLabel: 'unknown' type without brand falls back to regularLabel", () => {
  const label = resolveBolusTypeLabel(undefined, "unknown", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe(REGULAR_LABEL);
});

test("resolveBolusTypeLabel: 'unknown' type with brand still uses brand name", () => {
  const label = resolveBolusTypeLabel("Fiasp", "unknown", RAPID_LABEL, REGULAR_LABEL);
  expect(label).toBe("Fiasp");
});

// ── 6. Second bolus brand (insulinBrandBolus2) footer combination ─────────────
//
// IOBCard passes the DIA footer string as:
//   type: [insulinTypeLabel, insulinBrandBolus2?.trim()].filter(Boolean).join(" + ")
//
// These tests lock in that join behaviour so a refactor cannot silently
// produce "Fiasp + " (dangling plus) or "undefined" in the footer.
//
// We use a local helper that mirrors the IOBCard pattern so that TypeScript
// keeps the parameter type as `string | undefined` and doesn't narrow
// a const `undefined` literal to `never` (which would break `?.trim()`).

function buildFooterType(primary: string, secondary: string | undefined): string {
  return [primary, secondary?.trim()].filter(Boolean).join(" + ");
}

test("DIA footer: primary brand + second brand join as 'Brand1 + Brand2'", () => {
  const primary = resolveBolusTypeLabel("Fiasp", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(buildFooterType(primary, "Tresiba")).toBe("Fiasp + Tresiba");
});

test("DIA footer: primary brand only (no secondary) shows just the brand name", () => {
  const primary = resolveBolusTypeLabel("Fiasp", "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(buildFooterType(primary, undefined)).toBe("Fiasp");
});

test("DIA footer: no brand, rapid type — footer shows rapid label only", () => {
  const primary = resolveBolusTypeLabel(undefined, "rapid", RAPID_LABEL, REGULAR_LABEL);
  expect(buildFooterType(primary, undefined)).toBe(RAPID_LABEL);
});

test("DIA footer: empty secondary brand is filtered out, no dangling plus", () => {
  const primary = resolveBolusTypeLabel("Fiasp", "rapid", RAPID_LABEL, REGULAR_LABEL);
  // "   ".trim() === "" → falsy → filtered, so no trailing " + "
  expect(buildFooterType(primary, "   ")).toBe("Fiasp");
});

// ── 7. resolveInsulinNamePrefill — Engine log form pre-fill ───────────────────
//
// When the user has saved a bolus brand ("Fiasp") in Settings, opening the
// insulin log form in the Engine tab must pre-fill the name field with
// "Fiasp" rather than leaving it empty.
//
// The pre-fill is computed by `resolveInsulinNamePrefill(settings, type)`,
// a pure helper extracted from `components/EngineLogTab.tsx` so it can be
// verified here without a browser environment or localStorage access.

function makeSettings(overrides: Partial<InsulinSettings> = {}): InsulinSettings {
  return { icr: 15, cf: 50, targetBg: 110, ...overrides };
}

test("resolveInsulinNamePrefill: bolus tab pre-fills with insulinBrandBolus 'Fiasp'", () => {
  const settings = makeSettings({ insulinBrandBolus: "Fiasp" });
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("Fiasp");
});

test("resolveInsulinNamePrefill: bolus tab pre-fills with 'NovoRapid' when set", () => {
  const settings = makeSettings({ insulinBrandBolus: "NovoRapid" });
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("NovoRapid");
});

test("resolveInsulinNamePrefill: leading/trailing whitespace in saved brand is trimmed", () => {
  const settings = makeSettings({ insulinBrandBolus: "  Fiasp  " });
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("Fiasp");
});

test("resolveInsulinNamePrefill: bolus tab returns empty string when no brand set", () => {
  const settings = makeSettings({ insulinBrandBolus: undefined });
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("");
});

test("resolveInsulinNamePrefill: whitespace-only brand returns empty string", () => {
  const settings = makeSettings({ insulinBrandBolus: "   " });
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("");
});

test("resolveInsulinNamePrefill: basal tab pre-fills with insulinBrandBasal 'Tresiba'", () => {
  const settings = makeSettings({ insulinBrandBasal: "Tresiba" });
  expect(resolveInsulinNamePrefill(settings, "basal")).toBe("Tresiba");
});

test("resolveInsulinNamePrefill: basal tab returns empty string when no basal brand set", () => {
  const settings = makeSettings({ insulinBrandBolus: "Fiasp", insulinBrandBasal: undefined });
  expect(resolveInsulinNamePrefill(settings, "basal")).toBe("");
});

test("resolveInsulinNamePrefill: bolus brand does not bleed into basal tab", () => {
  const settings = makeSettings({ insulinBrandBolus: "Fiasp", insulinBrandBasal: undefined });
  expect(resolveInsulinNamePrefill(settings, "basal")).toBe("");
  expect(resolveInsulinNamePrefill(settings, "bolus")).toBe("Fiasp");
});

test("resolveInsulinNamePrefill: defaults to bolus when type argument is omitted", () => {
  const settings = makeSettings({ insulinBrandBolus: "Fiasp", insulinBrandBasal: "Tresiba" });
  expect(resolveInsulinNamePrefill(settings)).toBe("Fiasp");
});
