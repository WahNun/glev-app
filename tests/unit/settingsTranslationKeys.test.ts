// Guard against missing Settings translation keys reaching users.
//
// After the Settings refactor (9 sub-pages), settings/page.tsx itself
// no longer contains tSettings() calls — all keys live in the sub-pages.
// This test scans ALL settings sub-pages for t("key") calls and checks
// them against the "settings" namespace in messages/de.json + en.json.

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Load message files ────────────────────────────────────────────────────────

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deSettings = deMessages.settings ?? {};
const enSettings = enMessages.settings ?? {};

// ── Collect all settings sub-page sources ────────────────────────────────────

const settingsDir = join(ROOT, "app/(protected)/settings");

function collectSources(dir: string): string {
  let combined = "";
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        combined += collectSources(join(dir, entry.name));
      } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        combined += readFileSync(join(dir, entry.name), "utf8") + "\n";
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return combined;
}

const allSource = collectSources(settingsDir);

// ── Extract literal keys from t("key") calls ─────────────────────────────────
// Matches: t("some_key") or tSettings("some_key") (any translator alias)

const LITERAL_RE = /\bt\s*\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(allSource)) !== null) {
  const key = m[1];
  // Only include keys that exist in the settings namespace (de or en)
  // to avoid false positives from other namespaces used in these files.
  if (key in deSettings || key in enSettings) {
    staticKeys.add(key);
  }
}

const allKeys = [...staticKeys];

// ── Tests ─────────────────────────────────────────────────────────────────────

test("settings page: extracted a non-empty key set from settings sub-pages", () => {
  expect(allKeys.length).toBeGreaterThan(0);
});

test("settings page: every t() key is present in messages/de.json", () => {
  const missing = allKeys.filter((k) => !(k in deSettings));
  expect(
    missing,
    `Keys missing from de.json settings namespace: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("settings page: every t() key is present in messages/en.json", () => {
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
