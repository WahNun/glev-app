// tests/unit/timezoneTimestamp.test.ts
//
// Regression guard for timezone-aware timestamp helpers.
//
// Context
// ───────
// A bug was caught manually where a naive ISO string (no UTC offset) was
// treated as UTC instead of the user's local time. For a CEST user (+02:00)
// this shifted every logged entry 2 hours into the past. These tests pin the
// correct behaviour so the bug cannot silently reappear after a future
// refactor of `naiveIsoToUtcMs`, `resolveLoggedAt`, or `nowIsoWithOffset`.
//
// All three functions are exported from lib/ai/glevTools.ts — the single
// source of truth shared by both AI routes (chat and confirm-action).
//
// Coverage
// ────────
// naiveIsoToUtcMs:
//   1. CEST (+02:00) — naive "14:30" → 12:30 UTC
//   2. CET  (+01:00) — naive "14:30" → 13:30 UTC
//   3. UTC  (+00:00) — naive "14:30" → 14:30 UTC
//   4. EDT  (−04:00) — naive "14:30" → 18:30 UTC  (negative-offset zone, summer)
//   5. EST  (−05:00) — naive "14:30" → 19:30 UTC  (negative-offset zone, winter)
//   6. Optional seconds (HH:MM without :SS)
//   7. Invalid / garbage input → null
//   8. Invalid timezone → null
//
// nowIsoWithOffset:
//   9. Output matches ISO-8601 format  YYYY-MM-DDTHH:MM:SS±HH:MM
//  10. UTC produces +00:00 (not bare Z or numeric)
//  11. Parsing the result gives a Date within a few seconds of now
//  12. Europe/Berlin in CEST produces a "+02:00" suffix
//  13. Europe/Berlin in CET  produces a "+01:00" suffix
//  14. America/New_York in summer produces a "−04:00" suffix
//  15. null timezone defaults to Europe/Berlin
//
// resolveLoggedAt — full pipeline:
//  16. Naive ISO + CEST timezone → correct UTC ISO string  (the original bug)
//  17. Naive ISO + CET timezone  → correct UTC ISO string
//  18. Naive ISO + negative-offset zone (EDT) → correct UTC ISO string
//  19. Already-zoned ISO with +02:00 → pass-through to UTC
//  20. Already-zoned ISO with Z suffix → unchanged UTC
//  21. null raw  → falls back to ~now (within 5 s)
//  22. undefined raw + no timezone → falls back to ~now
//  23. Naive ISO with no timezone → JS Date UTC fallback (documented behaviour)

import { test, expect } from "@playwright/test";
import {
  naiveIsoToUtcMs,
  resolveLoggedAt,
  nowIsoWithOffset,
} from "@/lib/ai/glevTools";

// ── naiveIsoToUtcMs ──────────────────────────────────────────────────────────

test("naiveIsoToUtcMs: CEST (+02:00) — wall-clock 14:30 → 12:30 UTC", () => {
  // 5 June 2026 = CEST (Central European Summer Time, UTC+2)
  const ms = naiveIsoToUtcMs("2026-06-05T14:30:00", "Europe/Berlin");
  expect(ms).toBe(Date.UTC(2026, 5, 5, 12, 30, 0));
});

test("naiveIsoToUtcMs: CET (+01:00) — wall-clock 14:30 → 13:30 UTC", () => {
  // 15 January 2026 = CET (Central European Time, UTC+1)
  const ms = naiveIsoToUtcMs("2026-01-15T14:30:00", "Europe/Berlin");
  expect(ms).toBe(Date.UTC(2026, 0, 15, 13, 30, 0));
});

test("naiveIsoToUtcMs: UTC (+00:00) — wall-clock 14:30 → 14:30 UTC", () => {
  const ms = naiveIsoToUtcMs("2026-06-05T14:30:00", "UTC");
  expect(ms).toBe(Date.UTC(2026, 5, 5, 14, 30, 0));
});

test("naiveIsoToUtcMs: EDT (−04:00) — wall-clock 14:30 → 18:30 UTC (summer, negative offset)", () => {
  // 5 June 2026 = EDT (Eastern Daylight Time, UTC−4)
  const ms = naiveIsoToUtcMs("2026-06-05T14:30:00", "America/New_York");
  expect(ms).toBe(Date.UTC(2026, 5, 5, 18, 30, 0));
});

test("naiveIsoToUtcMs: EST (−05:00) — wall-clock 14:30 → 19:30 UTC (winter, negative offset)", () => {
  // 15 January 2026 = EST (Eastern Standard Time, UTC−5)
  const ms = naiveIsoToUtcMs("2026-01-15T14:30:00", "America/New_York");
  expect(ms).toBe(Date.UTC(2026, 0, 15, 19, 30, 0));
});

test("naiveIsoToUtcMs: seconds optional — no seconds in input is treated as :00", () => {
  // "2026-06-05T14:30" has no seconds component
  const ms = naiveIsoToUtcMs("2026-06-05T14:30", "UTC");
  expect(ms).toBe(Date.UTC(2026, 5, 5, 14, 30, 0));
});

test("naiveIsoToUtcMs: invalid / garbage input → null", () => {
  expect(naiveIsoToUtcMs("not-a-date", "Europe/Berlin")).toBeNull();
  expect(naiveIsoToUtcMs("", "Europe/Berlin")).toBeNull();
  expect(naiveIsoToUtcMs("2026-06-05", "Europe/Berlin")).toBeNull();
});

test("naiveIsoToUtcMs: invalid timezone → null (Intl throws, catch returns null)", () => {
  expect(naiveIsoToUtcMs("2026-06-05T14:30:00", "Not/A_Zone")).toBeNull();
});

// ── nowIsoWithOffset ─────────────────────────────────────────────────────────

test("nowIsoWithOffset: output matches ISO-8601 with explicit ±HH:MM offset", () => {
  const result = nowIsoWithOffset("Europe/Berlin");
  // Must be YYYY-MM-DDTHH:MM:SS±HH:MM — not bare Z, not numeric-only
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("nowIsoWithOffset: UTC produces +00:00 (not bare Z)", () => {
  const result = nowIsoWithOffset("UTC");
  expect(result).toMatch(/\+00:00$/);
});

test("nowIsoWithOffset: parsing the result recovers a Date within 5 seconds of now", () => {
  const before = Date.now();
  const result = nowIsoWithOffset("Europe/Berlin");
  const after = Date.now();
  const parsed = new Date(result).getTime();
  expect(parsed).toBeGreaterThanOrEqual(before - 5_000);
  expect(parsed).toBeLessThanOrEqual(after + 5_000);
});

test("nowIsoWithOffset: Europe/Berlin in CEST (summer) produces +02:00 suffix", () => {
  // Fix to a known CEST instant: 2026-06-05T12:00:00Z → 14:00 in Berlin
  const summerUtc = new Date("2026-06-05T12:00:00Z");
  const result = nowIsoWithOffset("Europe/Berlin", summerUtc);
  expect(result).toMatch(/\+02:00$/);
  expect(result).toContain("2026-06-05T14:00:00");
});

test("nowIsoWithOffset: Europe/Berlin in CET (winter) produces +01:00 suffix", () => {
  // Fix to a known CET instant: 2026-01-15T13:00:00Z → 14:00 in Berlin
  const winterUtc = new Date("2026-01-15T13:00:00Z");
  const result = nowIsoWithOffset("Europe/Berlin", winterUtc);
  expect(result).toMatch(/\+01:00$/);
  expect(result).toContain("2026-01-15T14:00:00");
});

test("nowIsoWithOffset: America/New_York in summer produces -04:00 suffix", () => {
  // 2026-06-05T18:00:00Z → 14:00 in New York (EDT, UTC−4)
  const summerUtc = new Date("2026-06-05T18:00:00Z");
  const result = nowIsoWithOffset("America/New_York", summerUtc);
  expect(result).toMatch(/-04:00$/);
  expect(result).toContain("2026-06-05T14:00:00");
});

test("nowIsoWithOffset: null timezone defaults to Europe/Berlin", () => {
  const summerUtc = new Date("2026-06-05T12:00:00Z");
  const result = nowIsoWithOffset(null, summerUtc);
  expect(result).toContain("+02:00");
});

// ── resolveLoggedAt — full pipeline ──────────────────────────────────────────

test("resolveLoggedAt: naive ISO + CEST timezone → correct UTC ISO string", () => {
  // The original bug: "2026-06-05T14:30:00" treated as UTC would give
  // "2026-06-05T14:30:00.000Z" instead of the correct "2026-06-05T12:30:00.000Z".
  const result = resolveLoggedAt("2026-06-05T14:30:00", "Europe/Berlin");
  expect(result).toBe("2026-06-05T12:30:00.000Z");
});

test("resolveLoggedAt: naive ISO + CET timezone → correct UTC ISO string", () => {
  const result = resolveLoggedAt("2026-01-15T14:30:00", "Europe/Berlin");
  expect(result).toBe("2026-01-15T13:30:00.000Z");
});

test("resolveLoggedAt: naive ISO + negative-offset zone (EDT) → correct UTC ISO string", () => {
  const result = resolveLoggedAt("2026-06-05T14:30:00", "America/New_York");
  expect(result).toBe("2026-06-05T18:30:00.000Z");
});

test("resolveLoggedAt: already-zoned ISO with +02:00 → pass-through to UTC", () => {
  // Has an explicit offset — should be treated as an unambiguous timestamp
  const result = resolveLoggedAt("2026-06-05T14:30:00+02:00", "Europe/Berlin");
  expect(result).toBe("2026-06-05T12:30:00.000Z");
});

test("resolveLoggedAt: already-zoned ISO with Z suffix → unchanged UTC", () => {
  const result = resolveLoggedAt("2026-06-05T12:30:00Z", "Europe/Berlin");
  expect(result).toBe("2026-06-05T12:30:00.000Z");
});

test("resolveLoggedAt: null raw → falls back to approximately now (within 5 s)", () => {
  const before = Date.now();
  const result = resolveLoggedAt(null, "Europe/Berlin");
  const after = Date.now();
  const parsed = new Date(result).getTime();
  expect(parsed).toBeGreaterThanOrEqual(before - 5_000);
  expect(parsed).toBeLessThanOrEqual(after + 5_000);
});

test("resolveLoggedAt: missing raw (undefined) + no timezone → falls back to approximately now", () => {
  const before = Date.now();
  const result = resolveLoggedAt(undefined);
  const after = Date.now();
  const parsed = new Date(result).getTime();
  expect(parsed).toBeGreaterThanOrEqual(before - 5_000);
  expect(parsed).toBeLessThanOrEqual(after + 5_000);
});

test("resolveLoggedAt: naive ISO with no timezone falls back to JS Date parsing (not the bug zone)", () => {
  // When no timezone is provided for a naive ISO, resolveLoggedAt falls through
  // to `new Date(s)` which in Node.js treats naive ISO as UTC.
  // This test documents that behaviour explicitly — the offset is correct only
  // when a timezone is supplied.
  const result = resolveLoggedAt("2026-06-05T14:30:00");
  expect(result).toBe("2026-06-05T14:30:00.000Z");
});
