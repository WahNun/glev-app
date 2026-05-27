// Task #110 — Catch missing translation keys across the entire codebase before
// they reach users.
//
// This test complements the per-page tests (dashboardTranslationKeys,
// engineTranslationKeys, etc.) with a codebase-wide sweep that:
//
//   1. Walks every .tsx/.ts file under app/ and components/
//   2. Extracts every `const <var> = useTranslations("<namespace>")` binding
//   3. For each (varName, namespace) pair, collects all literal `<var>("key")`
//      calls in that file
//   4. Resolves each key (including next-intl dot-path notation like
//      `t("nightscout.token_optional_hint")`) within the namespace in both
//      de.json and en.json
//   5. When the same varName is bound to multiple namespaces in one file
//      (e.g. `tIns` used for both "insights" and "entriesExpand"), a key passes
//      if it resolves in ANY of the bound namespaces — this handles same-name
//      translator aliases declared in different component scopes.
//   6. Detects drift between the two locale files: namespaces or keys present
//      in one locale file but absent from the other
//
// LIMITATIONS (by design):
//   - Template-literal keys (`t(\`key_${var}\`)`) are NOT analysed here —
//     they are covered by the per-page tests where the enum domains are
//     explicitly enumerated.
//   - `useTranslations()` calls without a namespace argument are skipped.
//
// The test FAILS when:
//   - A new t("key") call is added to a component without adding the key to
//     both message files, OR
//   - A key is removed from a message file while still referenced in code, OR
//   - A key exists in one locale but not the other (drift), OR
//   - A namespace appears in one locale file but not the other.

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Load locale files ─────────────────────────────────────────────────────────

const ROOT = process.cwd();

type MessageTree = { [key: string]: string | MessageTree };

const deMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/de.json"), "utf8"),
) as MessageTree;

const enMessages = JSON.parse(
  readFileSync(join(ROOT, "messages/en.json"), "utf8"),
) as MessageTree;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively collect all .tsx/.ts files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Navigate a dot-separated path into a message tree.
 * Returns the value (leaf string or sub-tree) at that path, or undefined.
 *
 * Examples:
 *   resolvePath(tree, "onboarding.cgm")    → tree.onboarding.cgm (sub-tree)
 *   resolvePath(tree, "nightscout.btn_connect") → the string value
 */
function resolvePath(
  tree: MessageTree,
  dotPath: string,
): MessageTree | string | undefined {
  const parts = dotPath.split(".");
  let current: MessageTree | string = tree;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return undefined;
    }
    current = (current as MessageTree)[part];
  }
  return current;
}

/**
 * Check whether a translation key exists inside a namespace sub-tree.
 * The key itself may be a dot-path (next-intl supports nested access like
 * `t("nightscout.btn_connect")` which navigates into cgmSettings.nightscout).
 */
function keyExistsInNamespace(namespace: MessageTree, key: string): boolean {
  const resolved = resolvePath(namespace, key);
  return resolved !== undefined;
}

/**
 * Flatten all leaf-key paths in a message sub-tree (relative to the sub-tree
 * root). Used for drift detection.
 *
 * e.g. { a: "x", b: { c: "y" } } → ["a", "b.c"]
 */
function flatLeafKeys(obj: MessageTree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      out.push(...flatLeafKeys(v as MessageTree, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

// ── Scan source files ─────────────────────────────────────────────────────────

const SOURCE_DIRS = [
  join(ROOT, "app"),
  join(ROOT, "components"),
];

const allFiles = SOURCE_DIRS.flatMap(collectSourceFiles);

/**
 * Binding: `const <varName> = useTranslations("<namespace>")`
 * Captures varName and namespace (namespace may be dot-separated).
 * Also matches single-quoted namespaces.
 */
const BINDING_RE = /const\s+(\w+)\s*=\s*useTranslations\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Inline call: `useTranslations("namespace")("key")`
 * Captures namespace and key in one pass — no variable needed.
 * Also matches single-quoted variants.
 */
const INLINE_CALL_RE =
  /useTranslations\(\s*["']([^"']+)["']\s*\)\s*\(\s*["']([^"']+)["']/g;

/**
 * For a given variable name, match literal string argument calls.
 * Matches: varName("key") or varName( "key" )
 * Does NOT match template-literal calls.
 *
 * Note: \b ensures we match `t("k")` but not `tQuick("k")` when varName="t".
 */
function buildCallRE(varName: string): RegExp {
  return new RegExp(`\\b${varName}\\(\\s*["']([^"']+)["']`, "g");
}

interface MissingKey {
  file: string;
  varName: string;
  key: string;
  namespacesChecked: string[];
  locale: "de" | "en";
}

const missingKeys: MissingKey[] = [];
const namespacesNotInDe: string[] = [];
const namespacesNotInEn: string[] = [];

// Track all visited namespaces to avoid duplicate drift reports.
const visitedNamespaces = new Set<string>();

for (const filePath of allFiles) {
  const source = readFileSync(filePath, "utf8");
  const relPath = filePath.replace(ROOT + "/", "");

  // Collect all useTranslations bindings in this file
  const rawBindings: Array<{ varName: string; namespace: string }> = [];
  BINDING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BINDING_RE.exec(source)) !== null) {
    rawBindings.push({ varName: m[1], namespace: m[2] });
  }

  // Also scan inline calls: useTranslations("ns")("key")
  INLINE_CALL_RE.lastIndex = 0;
  let inl: RegExpExecArray | null;
  while ((inl = INLINE_CALL_RE.exec(source)) !== null) {
    const [, ns, key] = inl;
    // Register namespace for existence check
    if (!visitedNamespaces.has(ns)) {
      visitedNamespaces.add(ns);
      const deNs = resolvePath(deMessages, ns);
      const enNs = resolvePath(enMessages, ns);
      if (deNs === undefined || typeof deNs !== "object") namespacesNotInDe.push(ns);
      if (enNs === undefined || typeof enNs !== "object") namespacesNotInEn.push(ns);
    }
    const deNs = resolvePath(deMessages, ns);
    const enNs = resolvePath(enMessages, ns);
    if (deNs && typeof deNs === "object" && !keyExistsInNamespace(deNs as MessageTree, key)) {
      missingKeys.push({ file: relPath, varName: `useTranslations("${ns}")`, key, namespacesChecked: [ns], locale: "de" });
    }
    if (enNs && typeof enNs === "object" && !keyExistsInNamespace(enNs as MessageTree, key)) {
      missingKeys.push({ file: relPath, varName: `useTranslations("${ns}")`, key, namespacesChecked: [ns], locale: "en" });
    }
  }

  if (rawBindings.length === 0) continue;

  // Build a map: varName → Set<namespace> (one varName can bind multiple ns)
  const varToNamespaces = new Map<string, Set<string>>();
  for (const { varName, namespace } of rawBindings) {
    if (!varToNamespaces.has(varName)) {
      varToNamespaces.set(varName, new Set());
    }
    varToNamespaces.get(varName)!.add(namespace);
  }

  // Track namespace existence (once per namespace globally)
  for (const namespaces of varToNamespaces.values()) {
    for (const namespace of namespaces) {
      if (!visitedNamespaces.has(namespace)) {
        visitedNamespaces.add(namespace);
        const deNs = resolvePath(deMessages, namespace);
        const enNs = resolvePath(enMessages, namespace);
        if (deNs === undefined || typeof deNs !== "object") {
          namespacesNotInDe.push(namespace);
        }
        if (enNs === undefined || typeof enNs !== "object") {
          namespacesNotInEn.push(namespace);
        }
      }
    }
  }

  // For each varName, collect all literal key calls, then check them
  for (const [varName, namespaces] of varToNamespaces) {
    const callRE = buildCallRE(varName);
    const keyRefs = new Set<string>();
    callRE.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = callRE.exec(source)) !== null) {
      keyRefs.add(c[1]);
    }

    if (keyRefs.size === 0) continue;

    // Resolve each namespace object from both locales
    const deNsObjects = [...namespaces]
      .map((ns) => resolvePath(deMessages, ns))
      .filter((v): v is MessageTree => typeof v === "object" && v !== null);

    const enNsObjects = [...namespaces]
      .map((ns) => resolvePath(enMessages, ns))
      .filter((v): v is MessageTree => typeof v === "object" && v !== null);

    for (const key of keyRefs) {
      // A key PASSES if it resolves in ANY of the bound namespaces.
      // This handles same-name translator aliases in different component scopes
      // within the same file (e.g. tIns → "insights" and tIns → "entriesExpand").
      const foundInDe = deNsObjects.some((ns) => keyExistsInNamespace(ns, key));
      const foundInEn = enNsObjects.some((ns) => keyExistsInNamespace(ns, key));

      if (!foundInDe && deNsObjects.length > 0) {
        missingKeys.push({
          file: relPath,
          varName,
          key,
          namespacesChecked: [...namespaces],
          locale: "de",
        });
      }
      if (!foundInEn && enNsObjects.length > 0) {
        missingKeys.push({
          file: relPath,
          varName,
          key,
          namespacesChecked: [...namespaces],
          locale: "en",
        });
      }
    }
  }
}

// ── Drift detection: compare flat leaf keys in every top-level namespace ──────
//
// We collect all top-level keys from BOTH locale files so that namespaces
// present only in one locale are also caught (not just per-key drift within
// shared namespaces).

const driftKeysMismatches: Array<{
  namespace: string;
  onlyInDe: string[];
  onlyInEn: string[];
}> = [];

// Union of all top-level namespace keys across both locale files
const allTopLevelKeys = new Set([
  ...Object.keys(deMessages),
  ...Object.keys(enMessages),
]);

for (const topKey of allTopLevelKeys) {
  const deVal = (deMessages as MessageTree)[topKey];
  const enVal = (enMessages as MessageTree)[topKey];

  const deIsNamespace = typeof deVal === "object" && deVal !== null;
  const enIsNamespace = typeof enVal === "object" && enVal !== null;

  // If both are leaf strings (or one is missing entirely as a namespace),
  // record as drift unless both are simply absent (shouldn't happen).
  if (!deIsNamespace && !enIsNamespace) continue;

  const deLeafs = new Set(deIsNamespace ? flatLeafKeys(deVal as MessageTree) : []);
  const enLeafs = new Set(enIsNamespace ? flatLeafKeys(enVal as MessageTree) : []);

  const onlyInDe = [...deLeafs].filter((k) => !enLeafs.has(k));
  const onlyInEn = [...enLeafs].filter((k) => !deLeafs.has(k));

  // Also flag when the whole namespace is missing from one locale
  if (!deIsNamespace) {
    onlyInEn.push(...enLeafs);
  }
  if (!enIsNamespace) {
    onlyInDe.push(...deLeafs);
  }

  if (onlyInDe.length > 0 || onlyInEn.length > 0) {
    driftKeysMismatches.push({ namespace: topKey, onlyInDe, onlyInEn });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("global: source files were found and scanned", () => {
  expect(allFiles.length).toBeGreaterThan(0);
});

test("global: every useTranslations namespace exists in messages/de.json", () => {
  const missing = namespacesNotInDe;
  expect(
    missing,
    `Namespaces used in code but absent from de.json: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("global: every useTranslations namespace exists in messages/en.json", () => {
  const missing = namespacesNotInEn;
  expect(
    missing,
    `Namespaces used in code but absent from en.json: ${missing.join(", ")}`,
  ).toEqual([]);
});

test("global: every t(\"key\") literal call resolves in messages/de.json", () => {
  const missing = missingKeys.filter((e) => e.locale === "de");
  const formatted = missing.map(
    (e) =>
      `  [de] ${e.namespacesChecked.join(" | ")}.${e.key}  ` +
      `(${e.varName}("${e.key}") in ${e.file})`,
  );
  expect(
    missing,
    `Keys missing from de.json:\n${formatted.join("\n")}`,
  ).toEqual([]);
});

test("global: every t(\"key\") literal call resolves in messages/en.json", () => {
  const missing = missingKeys.filter((e) => e.locale === "en");
  const formatted = missing.map(
    (e) =>
      `  [en] ${e.namespacesChecked.join(" | ")}.${e.key}  ` +
      `(${e.varName}("${e.key}") in ${e.file})`,
  );
  expect(
    missing,
    `Keys missing from en.json:\n${formatted.join("\n")}`,
  ).toEqual([]);
});

test("global: de.json and en.json have the same keys in every namespace (drift check)", () => {
  const report = driftKeysMismatches
    .map(({ namespace, onlyInDe, onlyInEn }) => {
      const lines: string[] = [`  namespace "${namespace}":`];
      if (onlyInDe.length > 0) {
        lines.push(`    only in de.json: ${onlyInDe.join(", ")}`);
      }
      if (onlyInEn.length > 0) {
        lines.push(`    only in en.json: ${onlyInEn.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  expect(
    driftKeysMismatches,
    `Locale drift detected — keys present in one locale but not the other:\n${report}`,
  ).toEqual([]);
});
