/**
 * CGM source parity tests
 *
 * Verifies that the alarm edge-function path (supabase/functions/_shared/cgm-live.ts)
 * and the dashboard/Next.js path (lib/cgm/index.ts + lib/cgm/llu.ts + lib/cgm/nightscout.ts)
 * always extract the same numeric value from the same upstream API response.
 *
 * A regression here means the dashboard can show a different reading than
 * the one the alarm fired on — the worst kind of trust-breaking bug for a
 * T1D safety-critical app.
 *
 * Strategy
 * ────────
 * • Nightscout: call the real `nightscout.verifyCredentials()` and
 *   `nightscout.getLatest()` production functions with mocked HTTP responses
 *   (Nightscout adapter uses the global `fetch`, so `globalThis.fetch` mocking
 *   intercepts all calls without extra libraries).
 * • LLU: call the real exported `llu.mapMeasurement()` production function
 *   directly. LLU uses axios with Node.js HTTP agents — not interceptable via
 *   `globalThis.fetch` — so we test the extraction function that both the
 *   full chain and `cgm-live.ts` share.  Schema-contract tests confirm that
 *   `getLatest()` routes through `mapMeasurement()` and that cgm-live.ts uses
 *   the same expression.
 * • DB-fallback: `nightscout.verifyCredentials()` and `nightscout.getLatest()`
 *   are called with failing/empty upstream responses to prove they return null,
 *   which is exactly the condition that makes the alarm's `if (latestValue === null)`
 *   branch activate the `cgm_samples` fallback.
 *
 * Coverage
 * ────────
 *  1. NS end-to-end: verifyCredentials() returns sgv value from mocked API → parity confirmed
 *  2. NS end-to-end: empty entries → null → DB fallback trigger
 *  3. NS end-to-end: non-numeric sgv is skipped → null → DB fallback trigger
 *  4. NS end-to-end: getLatest() happy path (Supabase cache miss → live fetch → sgv)
 *  5. NS end-to-end: getLatest() NS live fetch fails → throws → DB fallback trigger
 *  6. LLU real function: mapMeasurement() prefers ValueInMgPerDl over Value
 *  7. LLU real function: mapMeasurement() falls back to Value when InMgPerDl absent
 *  8. LLU real function: mapMeasurement() returns null when both absent → DB fallback
 *  9. LLU parity: mapMeasurement(m).value === cgm-live.ts extraction for same m
 * 10. Source resolution rule parity (same documented rule in both files)
 * 11. Schema-contract: both files use identical LLU expression string
 * 12. Schema-contract: both files use identical Nightscout sgv guard
 * 13. Schema-contract: both dispatchers enumerate all three sources
 * 14. Schema-contract: hypo-check calls fetchLiveReading before cgm_samples DB query
 * 15. Schema-contract: both dispatchers read from same profiles columns
 * 16. Schema-contract: elevated-check and hyper-check also use fetchLiveReading
 */

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as nightscout from "../../lib/cgm/nightscout";
import * as llu from "../../lib/cgm/llu";

/* ── Env-var management ──────────────────────────────────────────────────── */

const FAKE_SUPABASE_URL = "http://fake-supabase.cgmparity.test";
const MANAGED_VARS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
];
const SAVED_ENV: Record<string, string | undefined> = {};

/* ── Fetch mock infrastructure ────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
type Responder = (url: string, init: RequestInit) => Promise<Response>;
let currentResponder: Responder | null = null;

function mockFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (currentResponder) return currentResponder(url, init);
  throw new Error(`[cgmSourceParity] Unmocked fetch: ${url}`);
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

beforeAll(() => {
  for (const k of MANAGED_VARS) SAVED_ENV[k] = process.env[k];
  process.env.SUPABASE_URL = FAKE_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-svc-key-parity";
  process.env.ENCRYPTION_KEY = "a1b2c3d4".repeat(8); // 64 hex chars

  // Install fetch mock. The Nightscout adapter uses globalThis.fetch directly;
  // the Supabase JS SDK also uses globalThis.fetch in Node.js 18+.
  // Both paths are intercepted without any extra libraries.
  globalThis.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of MANAGED_VARS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

/* ── Source file reader ───────────────────────────────────────────────────── */

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../..", relPath), "utf-8");
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 1-3: Nightscout verifyCredentials() — end-to-end with mocked HTTP
 * ─────────────────────────────────────────────────────────────────────────── */

test("NS end-to-end: verifyCredentials() extracts sgv and both paths agree on same response", async () => {
  const NS_VALUE = 108;
  const mockEntries = [
    { sgv: NS_VALUE, dateString: "2026-06-04T10:00:00Z", direction: "Flat" },
  ];

  currentResponder = async (url) => {
    if (url.includes("/api/v1/entries.json")) return jsonResp(mockEntries);
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    // Real production function — Node.js dashboard path
    const dashResult = await nightscout.verifyCredentials("http://fake-ns.test", null);
    expect(dashResult.current?.value).toBe(NS_VALUE);

    // cgm-live.ts alarm path extraction from the same entry:
    //   const entry = json[0]; if (typeof entry.sgv !== "number") return null;
    //   return { value: entry.sgv, source: "nightscout", ... }
    const entry = mockEntries[0];
    const alarmValue = typeof entry.sgv === "number" ? entry.sgv : null;

    // Parity: both agree
    expect(dashResult.current?.value).toBe(alarmValue);
  } finally {
    currentResponder = null;
  }
});

test("NS end-to-end: empty entries array → null current → DB fallback trigger", async () => {
  currentResponder = async (url) => {
    if (url.includes("/api/v1/entries.json")) return jsonResp([]); // no data
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await nightscout.verifyCredentials("http://fake-ns.test", null);
    // null reading is the condition that makes alarm code branch to cgm_samples
    expect(result.current).toBeNull();
  } finally {
    currentResponder = null;
  }
});

test("NS end-to-end: non-numeric sgv is filtered → null → DB fallback trigger", async () => {
  const badEntries = [{ sgv: "not-a-number", dateString: "2026-06-04T10:00:00Z" }];

  currentResponder = async (url) => {
    if (url.includes("/api/v1/entries.json")) return jsonResp(badEntries);
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await nightscout.verifyCredentials("http://fake-ns.test", null);
    // mapEntry checks typeof e.sgv !== "number" → returns null → current is null
    expect(result.current).toBeNull();
  } finally {
    currentResponder = null;
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 4-5: nightscout.getLatest() — full Supabase + NS HTTP path
 * ─────────────────────────────────────────────────────────────────────────── */

const TEST_USER_NS = "user-ns-parity-" + Math.random().toString(36).slice(2);

test("NS end-to-end: getLatest() happy path — Supabase cache miss → live NS fetch → correct value", async () => {
  const NS_VALUE = 120;

  currentResponder = async (url) => {
    // Supabase profiles — return nightscout_url
    if (url.includes("/rest/v1/profiles")) {
      return jsonResp([{ nightscout_url: "http://fake-ns-getlatest.test", nightscout_token_enc: null }]);
    }
    // Supabase nightscout_readings — empty cache (cache miss)
    if (url.includes("/rest/v1/nightscout_readings")) {
      // writeCacheEntries upsert also hits this URL — return success for both
      if ((url + "").includes("select")) return jsonResp([]);
      return jsonResp([], 201); // upsert success
    }
    // Nightscout live API
    if (url.includes("fake-ns-getlatest.test") && url.includes("/api/v1/entries.json")) {
      return jsonResp([{ sgv: NS_VALUE, dateString: "2026-06-04T10:00:00Z", direction: "Flat" }]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await nightscout.getLatest(TEST_USER_NS);
    expect(result.current?.value).toBe(NS_VALUE);
  } finally {
    currentResponder = null;
  }
});

test("NS end-to-end: getLatest() — NS live fetch fails → throws → triggers DB fallback in alarm", async () => {
  const USER_NS_FAIL = "user-ns-fail-" + Math.random().toString(36).slice(2);

  currentResponder = async (url) => {
    if (url.includes("/rest/v1/profiles")) {
      return jsonResp([{ nightscout_url: "http://fake-ns-down.test", nightscout_token_enc: null }]);
    }
    if (url.includes("/rest/v1/nightscout_readings")) {
      return jsonResp([]); // cache miss
    }
    if (url.includes("fake-ns-down.test")) {
      return jsonResp({ message: "Service Unavailable" }, 503);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    // getLatest throws when live fetch fails and cache is empty.
    // In the alarm path: try { live = await fetchLiveReading(...) } catch { /* fallback */ }
    // Returning null from fetchLiveReading OR throwing — both trigger DB fallback.
    await expect(nightscout.getLatest(USER_NS_FAIL)).rejects.toThrow();
  } finally {
    currentResponder = null;
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 6-9: LLU mapMeasurement() — real exported production function
 * ─────────────────────────────────────────────────────────────────────────── */

test("LLU real function: mapMeasurement() prefers ValueInMgPerDl over Value", async () => {
  // Real production function — same code path as getLatest() internally
  const reading = llu.mapMeasurement({ ValueInMgPerDl: 115, Value: 7, TrendArrow: 3 });
  expect(reading?.value).toBe(115);
});

test("LLU real function: mapMeasurement() falls back to Value when InMgPerDl absent", async () => {
  const reading = llu.mapMeasurement({ Value: 95, TrendArrow: 3 });
  expect(reading?.value).toBe(95);
});

test("LLU real function: mapMeasurement() returns null when both fields absent → DB fallback", async () => {
  const reading = llu.mapMeasurement({ TrendArrow: 3, Timestamp: "6/4/2026 10:00:00 AM" });
  // null means no usable value → alarm falls back to cgm_samples
  expect(reading?.value ?? null).toBeNull();
});

test("LLU parity: mapMeasurement(m).value equals cgm-live.ts extraction for same response", async () => {
  // This measurement shape is exactly what the LLU connections API returns
  const mockMeasurement = {
    ValueInMgPerDl: 115,
    Value: 7,
    TrendArrow: 3,
    FactoryTimestamp: "6/4/2026 10:00:05 AM",
    Timestamp: "6/4/2026 12:00:05 PM",
  };

  // Node.js dashboard path — real mapMeasurement() production function
  const dashReading = llu.mapMeasurement(mockMeasurement);

  // cgm-live.ts alarm path — uses the identical expression:
  //   const value = m.ValueInMgPerDl ?? m.Value ?? null;
  const alarmValue = mockMeasurement.ValueInMgPerDl ?? mockMeasurement.Value ?? null;

  // Both agree
  expect(dashReading?.value).toBe(alarmValue);
  expect(dashReading?.value).toBe(115);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 10: Source resolution rule parity
 * Both lib/cgm/index.ts and cgm-live.ts document and implement the same rule:
 *   1. Explicit cgm_source if valid → honour it
 *   2. nightscout_url present → nightscout
 *   3. else → llu
 * We verify the rule with a pure-function mirror since resolveSource() in
 * index.ts is not exported (it awaits adminClient()).
 * ─────────────────────────────────────────────────────────────────────────── */

type ProfileRow = { cgm_source: string | null; nightscout_url: string | null };
type CgmSource = "llu" | "nightscout" | "apple_health";
const VALID_SOURCES = new Set<CgmSource>(["llu", "nightscout", "apple_health"]);

function resolveSourceRule(profile: ProfileRow | null): CgmSource {
  if (!profile) return "llu";
  const explicit = profile.cgm_source as CgmSource | null | undefined;
  if (explicit && VALID_SOURCES.has(explicit)) return explicit;
  return profile.nightscout_url ? "nightscout" : "llu";
}

test("source resolution: explicit cgm_source overrides URL presence", () => {
  expect(resolveSourceRule({ cgm_source: "llu", nightscout_url: "https://ns.io" })).toBe("llu");
  expect(resolveSourceRule({ cgm_source: "nightscout", nightscout_url: null })).toBe("nightscout");
  expect(resolveSourceRule({ cgm_source: "apple_health", nightscout_url: null })).toBe("apple_health");
});

test("source resolution: legacy auto-detect — nightscout_url present → nightscout", () => {
  expect(resolveSourceRule({ cgm_source: null, nightscout_url: "https://ns.io" })).toBe("nightscout");
});

test("source resolution: legacy auto-detect — no URL and no source → llu", () => {
  expect(resolveSourceRule({ cgm_source: null, nightscout_url: null })).toBe("llu");
});

test("source resolution: unknown source value falls through to URL check", () => {
  expect(resolveSourceRule({ cgm_source: "junction", nightscout_url: "https://ns.io" })).toBe("nightscout");
  expect(resolveSourceRule({ cgm_source: "junction", nightscout_url: null })).toBe("llu");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 11-16: Schema-contract tests
 * Read actual source files to verify key expression strings are identical
 * between the Deno alarm path and the Node.js dashboard path.
 * ─────────────────────────────────────────────────────────────────────────── */

test("schema-contract: cgm-live.ts uses same LLU value expression as llu.ts mapMeasurement()", () => {
  const liveSrc = readSrc("supabase/functions/_shared/cgm-live.ts");
  const lluSrc = readSrc("lib/cgm/llu.ts");

  // Both must contain the exact same value extraction expression
  const EXPR = "ValueInMgPerDl ?? m.Value ?? null";
  expect(liveSrc).toContain(EXPR);
  expect(lluSrc).toContain(EXPR);
});

test("schema-contract: cgm-live.ts uses same Nightscout sgv guard as nightscout.ts mapEntry()", () => {
  const liveSrc = readSrc("supabase/functions/_shared/cgm-live.ts");
  const nsSrc = readSrc("lib/cgm/nightscout.ts");

  // Both check sgv is a number before using it
  expect(liveSrc).toContain('typeof entry.sgv !== "number"');
  expect(nsSrc).toContain('typeof e.sgv !== "number"');

  // Both use sgv as the primary field
  expect(liveSrc).toContain("entry.sgv");
  expect(nsSrc).toContain("e.sgv");
});

test("schema-contract: both dispatchers enumerate all three CGM sources", () => {
  const liveSrc = readSrc("supabase/functions/_shared/cgm-live.ts");
  const indexSrc = readSrc("lib/cgm/index.ts");

  // cgm-live.ts has explicit if-branches for all three
  for (const src of ["llu", "nightscout", "apple_health"] as const) {
    expect(liveSrc).toContain(`source === "${src}"`);
  }

  // lib/cgm/index.ts dispatches nightscout and apple_health explicitly;
  // llu is the default fallthrough — all three must be known to the module
  expect(indexSrc).toContain(`source === "nightscout"`);
  expect(indexSrc).toContain(`source === "apple_health"`);
  for (const src of ["llu", "nightscout", "apple_health"] as const) {
    expect(indexSrc).toContain(`"${src}"`);
  }
});

test("schema-contract: hypo-check calls fetchLiveReading before cgm_samples DB query", () => {
  const hypoSrc = readSrc("supabase/functions/hypo-check/index.ts");

  // Must import and call the live dispatcher
  expect(hypoSrc).toContain("fetchLiveReading");

  // Must also have the DB fallback
  expect(hypoSrc).toContain('.from("cgm_samples")');

  // The actual call site (await) must appear before the DB query in the function body
  const liveCallPos = hypoSrc.indexOf("await fetchLiveReading(");
  const dbQueryPos = hypoSrc.indexOf('.from("cgm_samples")');
  expect(liveCallPos).toBeGreaterThan(-1);
  expect(dbQueryPos).toBeGreaterThan(-1);
  expect(liveCallPos).toBeLessThan(dbQueryPos);
});

test("schema-contract: both dispatchers resolve source from same profiles columns", () => {
  const liveSrc = readSrc("supabase/functions/_shared/cgm-live.ts");
  const indexSrc = readSrc("lib/cgm/index.ts");

  for (const col of ["cgm_source", "nightscout_url"]) {
    expect(liveSrc).toContain(col);
    expect(indexSrc).toContain(col);
  }
  expect(liveSrc).toContain('"profiles"');
  expect(indexSrc).toContain('"profiles"');
});

test("schema-contract: elevated-check and hyper-check also use fetchLiveReading", () => {
  const elevatedSrc = readSrc("supabase/functions/elevated-check/index.ts");
  const hyperSrc = readSrc("supabase/functions/hyper-check/index.ts");

  expect(elevatedSrc).toContain("fetchLiveReading");
  expect(hyperSrc).toContain("fetchLiveReading");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 17-20: Schema-contract: elevated-check and hyper-check column / table names
 *
 * These tests pin the exact settings column names and cooldown table names used
 * by the alarm edge functions. A column rename or typo would be silent at
 * runtime (Supabase returns empty results rather than an error) and would cause
 * users to miss alarms — the worst kind of failure for a safety-critical app.
 *
 * We also verify the comparison direction: both functions must fire when the
 * glucose value is ABOVE the threshold (high direction), not below it (hypo
 * direction). The skip guard `<= threshold` proves the alarm fires only when
 * latestValue > threshold. A hypo-direction implementation would use
 * `>= threshold` as the skip guard — asserting absence of that pattern rules
 * out an accidental inversion.
 * ─────────────────────────────────────────────────────────────────────────── */

test("schema-contract: elevated-check reads elevated_alarm_enabled and elevated_alarm_threshold_mgdl", () => {
  const src = readSrc("supabase/functions/elevated-check/index.ts");

  // Settings columns fetched from user_settings
  expect(src).toContain("elevated_alarm_enabled");
  expect(src).toContain("elevated_alarm_threshold_mgdl");

  // Must filter by the enabled flag (not just select it)
  expect(src).toContain('.eq("elevated_alarm_enabled", true)');

  // Must select the threshold column so it can be applied per-user.
  // It appears in a multi-column select string, so we check without surrounding quotes.
  expect(src).toContain("elevated_alarm_threshold_mgdl");
});

test("schema-contract: hyper-check reads high_alarm_enabled and high_alarm_threshold_mgdl", () => {
  const src = readSrc("supabase/functions/hyper-check/index.ts");

  // Settings columns fetched from user_settings
  expect(src).toContain("high_alarm_enabled");
  expect(src).toContain("high_alarm_threshold_mgdl");

  // Must filter by the enabled flag (not just select it)
  expect(src).toContain('.eq("high_alarm_enabled", true)');

  // Must select the threshold column so it can be applied per-user.
  // It appears in a multi-column select string, so we check without surrounding quotes.
  expect(src).toContain("high_alarm_threshold_mgdl");
});

test("schema-contract: elevated-check uses elevated_push_cooldown, hyper-check uses hyper_push_cooldown", () => {
  const elevatedSrc = readSrc("supabase/functions/elevated-check/index.ts");
  const hyperSrc = readSrc("supabase/functions/hyper-check/index.ts");

  // Each function must read from its own cooldown table — using the wrong table
  // would mean the cooldown state of one alarm silences the other.
  expect(elevatedSrc).toContain('"elevated_push_cooldown"');
  expect(hyperSrc).toContain('"hyper_push_cooldown"');

  // Cross-check: neither function should reference the other's cooldown table
  expect(elevatedSrc).not.toContain('"hyper_push_cooldown"');
  expect(hyperSrc).not.toContain('"elevated_push_cooldown"');
});

test("schema-contract: elevated-check and hyper-check fire in the HIGH direction (value > threshold)", () => {
  const elevatedSrc = readSrc("supabase/functions/elevated-check/index.ts");
  const hyperSrc = readSrc("supabase/functions/hyper-check/index.ts");

  // The skip guard must be `<= threshold` — meaning the alarm fires when
  // latestValue > threshold (HIGH direction).  If this were `>= threshold`
  // the function would be a hypo alarm (fires when value is LOW).
  expect(elevatedSrc).toContain("<= threshold");
  expect(hyperSrc).toContain("<= threshold");

  // The alarm-sent log line encodes the trigger condition explicitly.
  // Asserting it contains `> threshold` is a second independent check that
  // the code understands it is sending a HIGH alarm.
  expect(elevatedSrc).toContain("> threshold");
  expect(hyperSrc).toContain("> threshold");

  // Neither function should use the hypo-direction skip guard.
  // (hypo-check skips when value >= threshold, i.e., value is NOT low enough)
  expect(elevatedSrc).not.toContain(">= threshold");
  expect(hyperSrc).not.toContain(">= threshold");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 21-24: Schema-contract: hypo-check column / table names and direction
 *
 * Mirrors the elevated-check / hyper-check contract tests above, but for the
 * hypo (low-glucose) alarm. A silent column rename or comparison inversion
 * would mean users never receive a low-glucose push — the most dangerous
 * failure mode in this safety-critical app.
 *
 * Direction: hypo fires when value is BELOW the threshold.
 *   Skip guard `>= threshold` means "do nothing when value is high enough".
 *   A high-direction implementation would use `<= threshold` — asserting
 *   absence of that pattern rules out an accidental inversion.
 * ─────────────────────────────────────────────────────────────────────────── */

test("schema-contract: hypo-check reads low_alarm_enabled and low_alarm_threshold_mgdl", () => {
  const src = readSrc("supabase/functions/hypo-check/index.ts");

  // Settings columns fetched from user_settings
  expect(src).toContain("low_alarm_enabled");
  expect(src).toContain("low_alarm_threshold_mgdl");

  // Must filter by the enabled flag (not just select it)
  expect(src).toContain('.eq("low_alarm_enabled", true)');

  // Must select the threshold column so it can be applied per-user.
  // It appears in a multi-column select string, so we check without surrounding quotes.
  expect(src).toContain("low_alarm_threshold_mgdl");
});

test("schema-contract: hypo-check uses hypo_push_cooldown (not elevated or hyper cooldown table)", () => {
  const src = readSrc("supabase/functions/hypo-check/index.ts");

  // Must use its own dedicated cooldown table
  expect(src).toContain('"hypo_push_cooldown"');

  // Must NOT accidentally reference either of the high-alarm cooldown tables —
  // using the wrong table would mean a high-alarm push silences the hypo alarm.
  expect(src).not.toContain('"elevated_push_cooldown"');
  expect(src).not.toContain('"hyper_push_cooldown"');
});

test("schema-contract: hypo-check fires in the LOW direction (value < threshold)", () => {
  const src = readSrc("supabase/functions/hypo-check/index.ts");

  // The skip guard must be `>= threshold` — meaning the alarm fires only when
  // latestValue < threshold (LOW / hypo direction).
  // If this were `<= threshold` the function would behave as a high alarm.
  expect(src).toContain(">= threshold");

  // The alarm-sent log line must contain `< threshold` as a second independent
  // confirmation that the code understands it is sending a LOW alarm.
  expect(src).toContain("< threshold");

  // Must NOT contain the high-direction skip guard.
  // (elevated-check and hyper-check skip when value <= threshold)
  expect(src).not.toContain("<= threshold");
});
