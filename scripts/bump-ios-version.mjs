#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PBXPROJ = resolve(__dirname, "..", "ios", "App", "App.xcodeproj", "project.pbxproj");

function usage() {
  console.error(
    [
      "Usage: node scripts/bump-ios-version.mjs <command> [value]",
      "",
      "Commands:",
      "  show                          Print current MARKETING_VERSION + CURRENT_PROJECT_VERSION",
      "  build                         Increment CURRENT_PROJECT_VERSION by 1 (every config)",
      "  build --set <n>               Set CURRENT_PROJECT_VERSION to <n>",
      "  marketing patch|minor|major   Bump MARKETING_VERSION (semver)",
      "  marketing --set <x.y.z>       Set MARKETING_VERSION to literal value",
      "  release patch|minor|major     marketing <bump> + reset build to 1",
      "",
      "Both MARKETING_VERSION and CURRENT_PROJECT_VERSION live in",
      "ios/App/App.xcodeproj/project.pbxproj and must match across Debug + Release configs",
      "for App Store Connect to accept the upload.",
    ].join("\n"),
  );
  process.exit(2);
}

function readPbxproj() {
  return readFileSync(PBXPROJ, "utf8");
}

function writePbxproj(contents) {
  writeFileSync(PBXPROJ, contents);
}

function readSetting(text, key) {
  const re = new RegExp(`${key}\\s*=\\s*([^;]+);`, "g");
  const values = new Set();
  for (const m of text.matchAll(re)) values.add(m[1].trim());
  if (values.size === 0) {
    throw new Error(`No occurrences of ${key} found in project.pbxproj`);
  }
  if (values.size > 1) {
    throw new Error(
      `Inconsistent ${key} values across build configurations: ${[...values].join(", ")}. Fix manually before bumping.`,
    );
  }
  return [...values][0];
}

function writeSetting(text, key, value) {
  const re = new RegExp(`(${key}\\s*=\\s*)([^;]+)(;)`, "g");
  let count = 0;
  const updated = text.replace(re, (_match, prefix, _old, suffix) => {
    count += 1;
    return `${prefix}${value}${suffix}`;
  });
  if (count === 0) throw new Error(`No occurrences of ${key} to update`);
  return { updated, count };
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new Error(`MARKETING_VERSION '${v}' is not a 1-3 segment semver`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function bumpSemver([major, minor, patch], kind) {
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown semver bump '${kind}'`);
}

function show() {
  const text = readPbxproj();
  const marketing = readSetting(text, "MARKETING_VERSION");
  const build = readSetting(text, "CURRENT_PROJECT_VERSION");
  console.log(JSON.stringify({ marketingVersion: marketing, buildNumber: build }, null, 2));
}

function bumpBuild(args) {
  const text = readPbxproj();
  const current = readSetting(text, "CURRENT_PROJECT_VERSION");
  let next;
  const setIdx = args.indexOf("--set");
  if (setIdx !== -1) {
    next = String(args[setIdx + 1] ?? "").trim();
    if (!/^\d+$/.test(next)) throw new Error(`--set requires an integer, got '${next}'`);
  } else {
    if (!/^\d+$/.test(current)) {
      throw new Error(`CURRENT_PROJECT_VERSION '${current}' is not numeric, refuse to auto-increment`);
    }
    next = String(Number(current) + 1);
  }
  const { updated, count } = writeSetting(text, "CURRENT_PROJECT_VERSION", next);
  writePbxproj(updated);
  console.log(`CURRENT_PROJECT_VERSION: ${current} -> ${next} (updated ${count} build configs)`);
}

function bumpMarketing(args) {
  const text = readPbxproj();
  const current = readSetting(text, "MARKETING_VERSION");
  let next;
  const setIdx = args.indexOf("--set");
  if (setIdx !== -1) {
    next = String(args[setIdx + 1] ?? "").trim();
    parseSemver(next); // validate
  } else {
    const kind = args[0];
    if (!kind) throw new Error("marketing requires patch|minor|major or --set <x.y.z>");
    next = bumpSemver(parseSemver(current), kind);
  }
  const { updated, count } = writeSetting(text, "MARKETING_VERSION", next);
  writePbxproj(updated);
  console.log(`MARKETING_VERSION: ${current} -> ${next} (updated ${count} build configs)`);
}

function release(args) {
  bumpMarketing(args);
  // Reset build number to 1 for a brand-new marketing version.
  const text = readPbxproj();
  const current = readSetting(text, "CURRENT_PROJECT_VERSION");
  const { updated } = writeSetting(text, "CURRENT_PROJECT_VERSION", "1");
  writePbxproj(updated);
  console.log(`CURRENT_PROJECT_VERSION: ${current} -> 1 (reset for new marketing version)`);
}

const [, , command, ...rest] = process.argv;
try {
  switch (command) {
    case "show":
      show();
      break;
    case "build":
      bumpBuild(rest);
      break;
    case "marketing":
      bumpMarketing(rest);
      break;
    case "release":
      release(rest);
      break;
    default:
      usage();
  }
} catch (err) {
  console.error(`bump-ios-version: ${err.message}`);
  process.exit(1);
}
