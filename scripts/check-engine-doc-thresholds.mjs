#!/usr/bin/env node
/**
 * check-engine-doc-thresholds.mjs
 *
 * Verifies that every row in the "## Threshold Index" table of
 * docs/engine-algorithm.md matches the corresponding exported constant
 * in the TypeScript source file.
 *
 * Run via:   node scripts/check-engine-doc-thresholds.mjs
 * Or:        pnpm run check:engine-doc
 *
 * Exit 0 = all values match.
 * Exit 1 = one or more mismatches or the index table is missing.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Parse the Threshold Index table from the doc
// ---------------------------------------------------------------------------

const DOC_PATH = join(ROOT, "docs/engine-algorithm.md");
let doc;
try {
  doc = readFileSync(DOC_PATH, "utf8");
} catch {
  console.error(`ERROR: Cannot read ${DOC_PATH}`);
  process.exit(1);
}

// Find the "## Threshold Index" section
const indexStart = doc.indexOf("## Threshold Index");
if (indexStart === -1) {
  console.error(
    "ERROR: docs/engine-algorithm.md is missing the '## Threshold Index' section.\n" +
    "Add it back or run the check-engine-doc-thresholds script on the latest doc."
  );
  process.exit(1);
}

const indexSection = doc.slice(indexStart);

// Parse markdown table rows: | CONSTANT | path/to/file.ts | value |
// Skips the header row and separator row.
const ROW_RE = /^\|\s*([A-Z_]+)\s*\|\s*([^\|]+?)\s*\|\s*([\d.]+)\s*\|/gm;
const docEntries = [];
let m;
while ((m = ROW_RE.exec(indexSection)) !== null) {
  const name  = m[1].trim();
  const file  = m[2].trim();
  const value = m[3].trim();
  if (name === "CONSTANT") continue; // header row
  docEntries.push({ name, file, value });
}

if (docEntries.length === 0) {
  console.error("ERROR: Threshold Index table found but contains no data rows.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. For each entry, extract the constant value from the TypeScript source
// ---------------------------------------------------------------------------

/**
 * Reads a TypeScript source file and returns the numeric value of an
 * exported const: `export const NAME = <number>;`
 *
 * Returns null when the constant is not found.
 */
function extractConstant(filePath, constName) {
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    return { error: `Cannot read ${filePath}` };
  }

  // Match: export const CONSTANT_NAME = <number>;
  // Also tolerates trailing spaces and optional semicolon.
  const pattern = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*([\\d.]+)\\s*;?`
  );
  const hit = pattern.exec(src);
  if (!hit) return { error: `Constant '${constName}' not found in ${filePath}` };
  return { value: hit[1] };
}

// ---------------------------------------------------------------------------
// 3. Compare and report
// ---------------------------------------------------------------------------

let allOk = true;

for (const entry of docEntries) {
  const srcPath = join(ROOT, entry.file);
  const result  = extractConstant(srcPath, entry.name);

  if (result.error) {
    console.error(`MISMATCH  ${entry.name}: ${result.error}`);
    allOk = false;
    continue;
  }

  // Normalise: compare as floats to avoid "1.5" vs "1.50" issues
  const docVal = parseFloat(entry.value);
  const srcVal = parseFloat(result.value);

  if (Number.isNaN(docVal) || Number.isNaN(srcVal) || docVal !== srcVal) {
    console.error(
      `MISMATCH  ${entry.name}\n` +
      `          doc says: ${entry.value}  (in docs/engine-algorithm.md Threshold Index)\n` +
      `          src says: ${result.value}  (in ${entry.file})\n` +
      `          → Update one to match the other, then re-run this script.`
    );
    allOk = false;
  } else {
    console.log(`OK        ${entry.name} = ${result.value}  (${entry.file})`);
  }
}

if (!allOk) {
  console.error(
    "\n" +
    "One or more Engine thresholds are out of sync between the TypeScript\n" +
    "source and docs/engine-algorithm.md.\n" +
    "\n" +
    "To fix:\n" +
    "  1. Locate the mismatched constant in its source file.\n" +
    "  2. Update the '## Threshold Index' table in docs/engine-algorithm.md\n" +
    "     to match the source value (or vice-versa).\n" +
    "  3. Re-run: node scripts/check-engine-doc-thresholds.mjs\n"
  );
  process.exit(1);
}

console.log(`\nAll ${docEntries.length} threshold(s) match. ✓`);
