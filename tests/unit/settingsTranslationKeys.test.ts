// Task #530 — Guard against missing Settings translation keys reaching users.
//
// Background: Tasks #512 and #514 added translation-key guard tests for
// Engine, Dashboard, and Insights. Task #526 added coverage for Entries.
// This test extends the same guard to the Settings/Profile page, which
// carries the largest single `settings` namespace (183+ keys) and changes
// frequently with new preference rows and bottom-sheet flows.
//
// Namespace covered: "settings"
// Translator alias in page.tsx: tSettings  (bound to useTranslations("settings"))
//
// No dynamic / template-literal keys were found in settings/page.tsx at the
// time this test was written — all keys appear as literal strings.  If a
// dynamic key pattern is added later, enumerate it explicitly here (see
// insightsTranslationKeys.test.ts for examples).
//
// The test will FAIL when:
//   - a new `tSettings("some_key")` is added to settings/page.tsx without
//     adding the key to both message files, OR
//   - a key is removed from a message file while still referenced in the page.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load source files ────────────────────────────────────────────────────────

const ROOT = process.cwd();

const settingsSource = readFileSync(
  join(ROOT, "app/(protected)/settings/page.tsx"),
  "utf8",
);

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deSettings = deMessages.settings ?? {};
const enSettings = enMessages.settings ?? {};

// ── Extract static literal keys from tSettings("…") calls ───────────────────
//
// Matches: tSettings("some_key") or tSettings( "some_key" )
// The word-boundary is not needed here because `tSettings` is a unique prefix —
// no other translator alias in settings/page.tsx starts with `tSettings`.
//
// Does NOT match template-literal calls — those would need explicit enumeration.

const LITERAL_RE = /tSettings\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(settingsSource)) !== null) {
  staticKeys.add(m[1]);
}

// ── All keys the page depends on ─────────────────────────────────────────────

const allKeys = [...staticKeys];

// ── Tests ────────────────────────────────────────────────────────────────────

test("settings page: extracted a non-empty key set from settings/page.tsx", () => {
  expect(allKeys.length).toBeGreaterThan(0);
});

test("settings page: every tSettings() key is present in messages/de.json", () => {
  const missing = allKeys.filter((k) => !(k in deSettings));
  expect(
    missing,
    `Keys missing from de.json settings namespace: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("settings page: every tSettings() key is present in messages/en.json", () => {
  const missing = allKeys.filter((k) => !(k in enSettings));
  expect(
    missing,
    `Keys missing from en.json settings namespace: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("settings page: de.json and en.json settings namespaces have the same keys", () => {
  const deKeys = new Set(Object.keys(deSettings));
  const enKeys = new Set(Object.keys(enSettings));

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
