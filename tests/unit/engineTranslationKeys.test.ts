// Task #512 — Guard against missing Engine translation keys reaching users.
//
// Background: IOB badge strings were hardcoded for a long time before being
// caught manually. This test ensures that every `tEngine("…")` literal call
// in `app/(protected)/engine/page.tsx` resolves to an existing key in the
// `engine` namespace of both `messages/de.json` and `messages/en.json`.
//
// It also covers the six dynamic confidence keys that are assembled via
// template literals (`conf_label_HIGH/MEDIUM/LOW`, `conf_explain_HIGH/MEDIUM/LOW`)
// since those can't be caught by static string extraction alone.
//
// The test will FAIL when:
//   - a new `tEngine("some_key")` is added to engine/page.tsx without
//     adding the key to both message files, OR
//   - a key is removed from a message file while still referenced in the page.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Load source files ────────────────────────────────────────────────────────

const ROOT = process.cwd();

const engineSource = readFileSync(
  join(ROOT, "app/(protected)/engine/page.tsx"),
  "utf8",
);

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as Record<string, Record<string, unknown>>;

const deEngine = deMessages.engine ?? {};
const enEngine = enMessages.engine ?? {};

// ── Extract static literal keys from tEngine("…") calls ─────────────────────
//
// Matches: tEngine("some_key") or tEngine( "some_key" )
// Does NOT match template-literal calls — those are handled separately below.

const LITERAL_RE = /tEngine\(\s*"([^"]+)"/g;

const staticKeys = new Set<string>();
let m: RegExpExecArray | null;
while ((m = LITERAL_RE.exec(engineSource)) !== null) {
  staticKeys.add(m[1]);
}

// ── Dynamic / template-literal confidence keys ───────────────────────────────
//
// engine/page.tsx uses: tEngine(`conf_label_${result.confidence}` as never)
// and: tEngine(`conf_explain_${result.confidence}` as never)
// Confidence values are HIGH | MEDIUM | LOW (see lib/engine.ts).

const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
const dynamicKeys: string[] = [
  ...CONFIDENCE_LEVELS.map((c) => `conf_label_${c}`),
  ...CONFIDENCE_LEVELS.map((c) => `conf_explain_${c}`),
];

// ── All keys the page depends on ─────────────────────────────────────────────

const allKeys = [...staticKeys, ...dynamicKeys];

// ── Tests ────────────────────────────────────────────────────────────────────

test("engine page: every tEngine() key is present in messages/de.json", () => {
  const missing = allKeys.filter((k) => !(k in deEngine));
  expect(missing, `Keys missing from de.json engine namespace: ${missing.join(", ")}`).toEqual([]);
});

test("engine page: every tEngine() key is present in messages/en.json", () => {
  const missing = allKeys.filter((k) => !(k in enEngine));
  expect(missing, `Keys missing from en.json engine namespace: ${missing.join(", ")}`).toEqual([]);
});

test("engine page: de.json and en.json engine namespaces have the same keys", () => {
  const deKeys = new Set(Object.keys(deEngine));
  const enKeys = new Set(Object.keys(enEngine));

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
