// tests/unit/bumpIosVersion.test.ts
//
// Unit coverage for `scripts/bump-ios-version.mjs` — the single source of
// truth for iOS MARKETING_VERSION and CURRENT_PROJECT_VERSION bumps that
// every TestFlight upload goes through.
//
// ─── Coverage ────────────────────────────────────────────────────────────────
//   1. show         — prints marketingVersion + buildNumber as JSON
//   2. build        — increments CURRENT_PROJECT_VERSION by 1 across all configs
//   3. build --set N — sets CURRENT_PROJECT_VERSION to a specific integer
//   4. marketing patch|minor|major — semver bumps of MARKETING_VERSION
//   5. marketing --set x.y.z       — sets MARKETING_VERSION to a literal value
//   6. release minor               — bumps marketing AND resets build to 1
//   7. Invalid: marketing --set 1.2.3.4 — too many semver segments → exit 1
//   8. Invalid: build --set abc         — non-integer value → exit 1
//   9. Inconsistent guard: mismatched versions across Debug/Release → exit 1
//
// ─── CI-safe design ──────────────────────────────────────────────────────────
//   • No live Xcode project touched — the script is pointed at a minimal
//     fixture pbxproj via the PBXPROJ_PATH env var override added to the
//     script for testability.
//   • Each test gets its own fresh temp copy of the fixture so mutations
//     from one test never affect another.
//   • Runs as a Playwright unit test (no browser, no dev-server) — same
//     convention as tests/unit/evaluation.test.ts and others.

import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../scripts/bump-ios-version.mjs");
const FIXTURE = resolve(__dirname, "fixtures/bump-ios-version.pbxproj");
const FIXTURE_INCONSISTENT = resolve(
  __dirname,
  "fixtures/bump-ios-version-inconsistent.pbxproj",
);

function makeTempPbxproj(source = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "glev-ios-test-"));
  const dest = join(dir, "project.pbxproj");
  copyFileSync(source, dest);
  return dest;
}

function run(args: string[], pbxprojPath: string) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, PBXPROJ_PATH: pbxprojPath },
    encoding: "utf8",
  });
}

function showJson(pbxprojPath: string) {
  const r = run(["show"], pbxprojPath);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout) as {
    marketingVersion: string;
    buildNumber: string;
  };
}

// ── show ─────────────────────────────────────────────────────────────────────

test("show: prints marketingVersion and buildNumber as JSON", () => {
  const path = makeTempPbxproj();
  const result = run(["show"], path);
  expect(result.status).toBe(0);
  const json = JSON.parse(result.stdout);
  expect(json.marketingVersion).toBe("1.3.0");
  expect(json.buildNumber).toBe("42");
});

// ── build ─────────────────────────────────────────────────────────────────────

test("build: increments CURRENT_PROJECT_VERSION by 1", () => {
  const path = makeTempPbxproj();
  const result = run(["build"], path);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/42 -> 43/);
  expect(showJson(path).buildNumber).toBe("43");
});

test("build: updates all build configurations (Debug + Release)", () => {
  const path = makeTempPbxproj();
  run(["build"], path);
  const content = readFileSync(path, "utf8");
  const matches = [...content.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g)];
  expect(matches.length).toBeGreaterThanOrEqual(2);
  for (const m of matches) {
    expect(m[1].trim()).toBe("43");
  }
});

// ── build --set N ─────────────────────────────────────────────────────────────

test("build --set 100: sets CURRENT_PROJECT_VERSION to 100", () => {
  const path = makeTempPbxproj();
  const result = run(["build", "--set", "100"], path);
  expect(result.status).toBe(0);
  expect(showJson(path).buildNumber).toBe("100");
});

test("build --set 1: sets CURRENT_PROJECT_VERSION to 1", () => {
  const path = makeTempPbxproj();
  const result = run(["build", "--set", "1"], path);
  expect(result.status).toBe(0);
  expect(showJson(path).buildNumber).toBe("1");
});

// ── marketing patch|minor|major ───────────────────────────────────────────────

test("marketing patch: bumps patch segment 1.3.0 -> 1.3.1", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "patch"], path);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1\.3\.0 -> 1\.3\.1/);
  expect(showJson(path).marketingVersion).toBe("1.3.1");
});

test("marketing minor: bumps minor segment and resets patch 1.3.0 -> 1.4.0", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "minor"], path);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1\.3\.0 -> 1\.4\.0/);
  expect(showJson(path).marketingVersion).toBe("1.4.0");
});

test("marketing major: bumps major segment and resets minor+patch 1.3.0 -> 2.0.0", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "major"], path);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1\.3\.0 -> 2\.0\.0/);
  expect(showJson(path).marketingVersion).toBe("2.0.0");
});

// ── marketing --set x.y.z ─────────────────────────────────────────────────────

test("marketing --set 3.1.4: sets MARKETING_VERSION to literal value", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "--set", "3.1.4"], path);
  expect(result.status).toBe(0);
  expect(showJson(path).marketingVersion).toBe("3.1.4");
});

test("marketing --set 2.0: accepts 2-segment semver", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "--set", "2.0"], path);
  expect(result.status).toBe(0);
  expect(showJson(path).marketingVersion).toBe("2.0");
});

// ── release minor ─────────────────────────────────────────────────────────────

test("release minor: bumps marketing minor AND resets build to 1", () => {
  const path = makeTempPbxproj();
  const result = run(["release", "minor"], path);
  expect(result.status).toBe(0);
  const { marketingVersion, buildNumber } = showJson(path);
  expect(marketingVersion).toBe("1.4.0");
  expect(buildNumber).toBe("1");
});

test("release patch: bumps marketing patch AND resets build to 1", () => {
  const path = makeTempPbxproj();
  const result = run(["release", "patch"], path);
  expect(result.status).toBe(0);
  const { marketingVersion, buildNumber } = showJson(path);
  expect(marketingVersion).toBe("1.3.1");
  expect(buildNumber).toBe("1");
});

test("release major: bumps marketing major AND resets build to 1", () => {
  const path = makeTempPbxproj();
  const result = run(["release", "major"], path);
  expect(result.status).toBe(0);
  const { marketingVersion, buildNumber } = showJson(path);
  expect(marketingVersion).toBe("2.0.0");
  expect(buildNumber).toBe("1");
});

// ── invalid inputs ────────────────────────────────────────────────────────────

test("marketing --set 1.2.3.4: exits 1 for too many semver segments", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "--set", "1.2.3.4"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/not a 1-3 segment semver/);
});

test("marketing --set abc: exits 1 for non-numeric semver", () => {
  const path = makeTempPbxproj();
  const result = run(["marketing", "--set", "abc"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/not a 1-3 segment semver/);
});

test("build --set abc: exits 1 for non-integer build number", () => {
  const path = makeTempPbxproj();
  const result = run(["build", "--set", "abc"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/requires an integer/);
});

test("build --set 1.2: exits 1 for decimal build number", () => {
  const path = makeTempPbxproj();
  const result = run(["build", "--set", "1.2"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/requires an integer/);
});

test("unknown command: exits 2", () => {
  const path = makeTempPbxproj();
  const result = run(["frobnicate"], path);
  expect(result.status).toBe(2);
});

// ── inconsistent values guard ─────────────────────────────────────────────────

test("inconsistent MARKETING_VERSION across Debug/Release: exits 1", () => {
  const path = makeTempPbxproj(FIXTURE_INCONSISTENT);
  const result = run(["show"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Inconsistent MARKETING_VERSION/);
});

test("inconsistent MARKETING_VERSION: build command also blocked", () => {
  const path = makeTempPbxproj(FIXTURE_INCONSISTENT);
  const result = run(["marketing", "patch"], path);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Inconsistent MARKETING_VERSION/);
});
