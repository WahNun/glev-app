#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_GRADLE = resolve(__dirname, "..", "android", "app", "build.gradle");

function usage() {
  console.error(
    [
      "Usage: node scripts/bump-android-version.mjs <command> [value]",
      "",
      "Commands:",
      "  show                          Print current versionName + versionCode",
      "  build                         Increment versionCode by 1",
      "  build --set <n>               Set versionCode to <n>",
      "  marketing patch|minor|major   Bump versionName (semver)",
      "  marketing --set <x.y.z>       Set versionName to literal value",
      "  release patch|minor|major     marketing <bump> + reset versionCode to 1",
      "",
      "Both versionName and versionCode live in android/app/build.gradle",
      "and must be incremented for every Play Store upload (versionCode must",
      "strictly increase across releases).",
    ].join("\n"),
  );
  process.exit(2);
}

function readGradle() {
  return readFileSync(BUILD_GRADLE, "utf8");
}

function writeGradle(contents) {
  writeFileSync(BUILD_GRADLE, contents);
}

function readVersionCode(text) {
  const m = /\bversionCode\s+(\d+)\b/.exec(text);
  if (!m) throw new Error("versionCode not found in android/app/build.gradle");
  return m[1];
}

function readVersionName(text) {
  const m = /\bversionName\s+"([^"]+)"/.exec(text);
  if (!m) throw new Error("versionName not found in android/app/build.gradle");
  return m[1];
}

function writeVersionCode(text, value) {
  const re = /(\bversionCode\s+)(\d+)\b/;
  if (!re.test(text)) throw new Error("versionCode not found in android/app/build.gradle");
  return text.replace(re, `$1${value}`);
}

function writeVersionName(text, value) {
  const re = /(\bversionName\s+")([^"]+)(")/;
  if (!re.test(text)) throw new Error("versionName not found in android/app/build.gradle");
  return text.replace(re, `$1${value}$3`);
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new Error(`versionName '${v}' is not a 1-3 segment semver`);
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function bumpSemver([major, minor, patch], kind) {
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown semver bump '${kind}'`);
}

function show() {
  const text = readGradle();
  const versionName = readVersionName(text);
  const versionCode = readVersionCode(text);
  console.log(JSON.stringify({ versionName, versionCode }, null, 2));
}

function bumpBuild(args) {
  const text = readGradle();
  const current = readVersionCode(text);
  let next;
  const setIdx = args.indexOf("--set");
  if (setIdx !== -1) {
    next = String(args[setIdx + 1] ?? "").trim();
    if (!/^\d+$/.test(next)) throw new Error(`--set requires an integer, got '${next}'`);
  } else {
    next = String(Number(current) + 1);
  }
  const updated = writeVersionCode(text, next);
  writeGradle(updated);
  console.log(`versionCode: ${current} -> ${next}`);
}

function bumpMarketing(args) {
  const text = readGradle();
  const current = readVersionName(text);
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
  const updated = writeVersionName(text, next);
  writeGradle(updated);
  console.log(`versionName: ${current} -> ${next}`);
}

function release(args) {
  bumpMarketing(args);
  const text = readGradle();
  const current = readVersionCode(text);
  const updated = writeVersionCode(text, "1");
  writeGradle(updated);
  console.log(`versionCode: ${current} -> 1 (reset for new versionName)`);
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
  console.error(`bump-android-version: ${err.message}`);
  process.exit(1);
}
