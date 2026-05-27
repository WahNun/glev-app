#!/usr/bin/env node
/**
 * check-outcome-coverage.mjs
 *
 * Targeted check that ensures every switch statement or object literal
 * in the codebase that explicitly enumerates the "SPIKE" Outcome value
 * also handles "SPIKE_STRONG".
 *
 * WHY THIS EXISTS
 * ---------------
 * Task #259: SPIKE_STRONG was added to the Outcome union after the
 * initial release.  New summary surfaces (PDF pages, CSV exports,
 * weekly emails, charts) could accidentally use a switch or object-map
 * that was written before SPIKE_STRONG existed and silently fall
 * through to a default/blank branch.  This script catches the gap at
 * commit time.
 *
 * WHAT IS CHECKED
 * ---------------
 * The script searches for lines that enumerate "SPIKE" as a concrete
 * Outcome value in a switch or object-literal context:
 *
 *   case "SPIKE":          — switch arm
 *   "SPIKE":               — object literal key (quoted)
 *   SPIKE:                 — object literal key (bare identifier at
 *                            line start or after { or ,)
 *
 * It does NOT flag:
 *   - "SPIKED" (exercise / insulin evaluator outcome — different type)
 *   - Comments or prose that mention SPIKE
 *   - Plain equality checks like `=== "SPIKE"` or `.toBe("SPIKE")`
 *     (these are assertions against a specific value, not an
 *     exhaustive enumeration missing SPIKE_STRONG)
 *
 * If any of these patterns is found in a file that does NOT also
 * reference SPIKE_STRONG, the check fails with exit code 1.
 *
 * FALSE-POSITIVE ALLOWLIST
 * ------------------------
 * Files listed in ALLOWLIST are exempt.  Add a path here (relative to
 * the project root) with a short note if the script flags it
 * incorrectly.
 *
 * EXIT CODE
 * ---------
 * 0 — no gaps found.
 * 1 — at least one file enumerates SPIKE in a switch/object but lacks
 *     SPIKE_STRONG.
 */

import { readFileSync, readdirSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Relative paths (from ROOT) that are exempt from this check. */
const ALLOWLIST = new Set([
  // Source-of-truth for the Outcome union.  Defines SPIKE_STRONG too.
  "lib/engine/evaluation.ts",

  // This script itself.
  "scripts/check-outcome-coverage.mjs",
]);

/** File extensions to scan. */
const EXTENSIONS = new Set([".ts", ".tsx"]);

/** Directories to skip entirely. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "android", "ios"]);

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(join(dir, entry.name));
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (EXTENSIONS.has(ext)) yield join(dir, entry.name);
    }
  }
}

/**
 * Matches "SPIKE" used as a concrete Outcome value in an enumeration
 * context (switch arm or object literal key) but NOT "SPIKED" or
 * "SPIKE_STRONG".
 *
 * Patterns matched (SPIKE not followed by _ or D):
 *   case "SPIKE":
 *   "SPIKE":
 *   SPIKE:   (bare key at start of expression, after {, or after ,)
 */
const SPIKE_AS_KEY_OR_CASE = /(?:case\s+["']SPIKE["']|["']SPIKE["']\s*:|(?:^|[{,\s])SPIKE\s*:)(?!_|D)/m;

/** Matches SPIKE_STRONG anywhere in the file (as a reference, key, case, etc.) */
const SPIKE_STRONG_ANY = /SPIKE_STRONG/;

const gaps = [];

for (const filePath of walkFiles(ROOT)) {
  const rel = relative(ROOT, filePath);
  if (ALLOWLIST.has(rel)) continue;

  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }

  if (!SPIKE_AS_KEY_OR_CASE.test(src)) continue;    // no enumeration of SPIKE here
  if (SPIKE_STRONG_ANY.test(src)) continue;         // already handles SPIKE_STRONG

  // Find the first matching line for a helpful error message.
  const lines = src.split("\n");
  const firstLine = lines.findIndex((l) => SPIKE_AS_KEY_OR_CASE.test(l));
  gaps.push({ rel, line: firstLine + 1 });
}

if (gaps.length === 0) {
  console.log(
    "✓ check:outcome-coverage — all switch/object enumerations of SPIKE also cover SPIKE_STRONG.",
  );
  process.exit(0);
} else {
  console.error(
    `\n✗ check:outcome-coverage — ${gaps.length} file(s) enumerate SPIKE in a switch or object` +
    ` literal but do not reference SPIKE_STRONG:\n`,
  );
  for (const { rel, line } of gaps) {
    console.error(`  ${rel}:${line}`);
  }
  console.error(
    "\n  Add SPIKE_STRONG handling to each location, or add the file to ALLOWLIST\n" +
    "  in scripts/check-outcome-coverage.mjs if the pattern is not an Outcome\n" +
    "  enumeration (e.g. a different 'SPIKE' concept with its own type).\n",
  );
  process.exit(1);
}
