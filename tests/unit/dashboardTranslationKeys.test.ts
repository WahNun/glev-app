// Task #514 — Guard against missing Dashboard translation keys reaching users.
//
// Background: The same class of bug that affected the Engine page (hardcoded
// strings instead of translation keys) can silently affect the Dashboard page
// too. This test ensures that every `t("…")` literal call in
// `app/(protected)/dashboard/page.tsx` (where `t = useTranslations("dashboard")`)
// resolves to an existing key in the `dashboard` namespace of both
// `messages/de.json` and `messages/en.json`.
//
// Note: The dashboard page aliases the dashboard translator as plain `t`
// (not `tDashboard`). Other namespaces use distinguishable aliases:
//   - tQuick → "quickAdd"
//   - tIns   → "insights" / "entriesExpand"
//   - tChips → "chips"
// The word-boundary regex /\bt\(/ matches `t("key")` but NOT those other
// aliases, so only dashboard-namespace keys are extracted.
//
// Dynamic / template-literal keys are enumerated explicitly below because the
// static regex cannot see through template expressions.  The one dynamic call
// in dashboard/page.tsx is:
//   t(`badge_${badge.key}`)   — badge.key ∈ { "strong", "good", "poor" }
//
// The test will FAIL when:
//   - a new `t("some_key")` is added to dashboard/page.tsx without
//     adding the key to both message files, OR
//   - a key is removed from a message file while still referenced in the page.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load source files ────────────────────────────────────────────────────────

const ROOT = process.cwd();

const dashboardSource = readFileSync(
  join(ROOT, "app/(protected)/dashboard/page.tsx"),
  "utf8",
);

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deDashboard = deMessages.dashboard ?? {};
const enDashboard = enMessages.dashboard ?? {};

// ── Extract static literal keys from t("…") calls ───────────────────────────
//
// The dashboard translator is bound to plain `t` (not `tDashboard`).
// Word-boundary \b ensures we match `t("key")` but not `tQuick("key")`,
// `tIns("key")`, `tChips("key")`, etc.
//
// Matches: t("some_key") or t( "some_key" )
// Does NOT match template-literal calls — those are handled separately below.

const LITERAL_RE = /\bt\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(dashboardSource)) !== null) {
  staticKeys.add(m[1]);
}

// ── Dynamic / template-literal keys ─────────────────────────────────────────
//
// dashboard/page.tsx uses: t(`badge_${badge.key}`)
// badge.key is one of the three evaluation outcomes visible in the dashboard.

const BADGE_KEYS = ["strong", "good", "poor"] as const;
const dynamicKeys: string[] = BADGE_KEYS.map((k) => `badge_${k}`);

// ── All keys the page depends on ─────────────────────────────────────────────

const allKeys = [...staticKeys, ...dynamicKeys];

// ── Tests ────────────────────────────────────────────────────────────────────

test("dashboard page: extracted a non-empty key set from dashboard/page.tsx", () => {
  expect(allKeys.length).toBeGreaterThan(0);
});

test("dashboard page: every t() key is present in messages/de.json", () => {
  const missing = allKeys.filter((k) => !(k in deDashboard));
  expect(missing, `Keys missing from de.json dashboard namespace: ${missing.join(", ")}`).toEqual([]);
});

test("dashboard page: every t() key is present in messages/en.json", () => {
  const missing = allKeys.filter((k) => !(k in enDashboard));
  expect(missing, `Keys missing from en.json dashboard namespace: ${missing.join(", ")}`).toEqual([]);
});

test("dashboard page: de.json and en.json dashboard namespaces have the same keys", () => {
  const deKeys = new Set(Object.keys(deDashboard));
  const enKeys = new Set(Object.keys(enDashboard));

  const onlyInDe = [...deKeys].filter((k) => !enKeys.has(k));
  const onlyInEn = [...enKeys].filter((k) => !deKeys.has(k));

  expect(
    onlyInDe,
    `Keys present in de.json but missing from en.json: ${onlyInDe.join(", ")}`,
  ).toEqual([]);
  expect(
    onlyInEn,
    `Keys present in en.json but missing from de.json: ${onlyInEn.join(", ")}`,
  ).toEqual([]);
});
