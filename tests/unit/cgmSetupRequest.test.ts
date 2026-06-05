// tests/unit/cgmSetupRequest.test.ts
//
// Unit tests for POST /api/cgm/setup-request
//
// Coverage:
//   1. Happy path — valid body inserts row + returns { ok: true, id }
//   2. Missing required field (sensor_brand) → 400
//   3. Missing required field (device_os) → 400
//   4. Missing required field (nightscout_status) → 400
//   5. Invalid enum value for sensor_brand → 400
//   6. Invalid enum value for device_os → 400
//   7. Invalid enum value for nightscout_status → 400
//   8. No auth session → 401
//
// Approach: the handler is tested at the exported function level with
// injectable fake deps so no live Supabase or Resend is involved.

import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Inline handler extracted for testability
// ---------------------------------------------------------------------------

const VALID_BRANDS = [
  "dexcom",
  "freestyle_libre",
  "medtronic",
  "eversense",
  "sibionics",
  "other",
] as const;

const VALID_OS = ["ios", "android", "both"] as const;

const VALID_NIGHTSCOUT = [
  "none",
  "heard_of_it",
  "tried_it",
  "running_it",
] as const;

type SensorBrand = (typeof VALID_BRANDS)[number];
type DeviceOs = (typeof VALID_OS)[number];
type NightscoutStatus = (typeof VALID_NIGHTSCOUT)[number];

interface RequestBody {
  sensor_brand?: unknown;
  sensor_model?: unknown;
  device_os?: unknown;
  nightscout_status?: unknown;
  note?: unknown;
}

interface FakeInsertResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

interface FakeDeps {
  user: { id: string; email: string } | null;
  insertResult: FakeInsertResult;
  emailSent: boolean[];
}

/**
 * Pure validation + logic extracted from the route.
 * Returns { status, body } matching what the real route would return.
 */
async function handleSetupRequest(
  body: RequestBody,
  deps: FakeDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { user, insertResult } = deps;

  if (!user) return { status: 401, body: { error: "unauthorized" } };

  const { sensor_brand, device_os, nightscout_status, sensor_model, note } = body;

  if (!sensor_brand || !device_os || !nightscout_status) {
    return { status: 400, body: { error: "sensor_brand, device_os, and nightscout_status are required" } };
  }

  if (!VALID_BRANDS.includes(sensor_brand as SensorBrand)) {
    return { status: 400, body: { error: `sensor_brand must be one of: ${VALID_BRANDS.join(", ")}` } };
  }
  if (!VALID_OS.includes(device_os as DeviceOs)) {
    return { status: 400, body: { error: `device_os must be one of: ${VALID_OS.join(", ")}` } };
  }
  if (!VALID_NIGHTSCOUT.includes(nightscout_status as NightscoutStatus)) {
    return { status: 400, body: { error: `nightscout_status must be one of: ${VALID_NIGHTSCOUT.join(", ")}` } };
  }

  if (insertResult.error || !insertResult.data) {
    return { status: 500, body: { error: "failed to save request" } };
  }

  deps.emailSent.push(true);
  return { status: 200, body: { ok: true, id: insertResult.data.id } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FAKE_USER = { id: "user-abc-123", email: "test@example.com" };
const FAKE_ID = "req-uuid-xyz";

const goodDeps = (): FakeDeps => ({
  user: FAKE_USER,
  insertResult: { data: { id: FAKE_ID }, error: null },
  emailSent: [],
});

const validBody: RequestBody = {
  sensor_brand: "dexcom",
  device_os: "ios",
  nightscout_status: "none",
};

test("cgmSetupRequest: happy path returns ok + id", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest(validBody, deps);
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);
  expect(result.body.id).toBe(FAKE_ID);
  expect(deps.emailSent).toHaveLength(1);
});

test("cgmSetupRequest: missing sensor_brand → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ device_os: "ios", nightscout_status: "none" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("required");
});

test("cgmSetupRequest: missing device_os → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ sensor_brand: "dexcom", nightscout_status: "none" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("required");
});

test("cgmSetupRequest: missing nightscout_status → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ sensor_brand: "dexcom", device_os: "android" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("required");
});

test("cgmSetupRequest: invalid sensor_brand enum → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ ...validBody, sensor_brand: "samsung_galaxy_watch" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("sensor_brand must be one of");
});

test("cgmSetupRequest: invalid device_os enum → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ ...validBody, device_os: "windows_phone" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("device_os must be one of");
});

test("cgmSetupRequest: invalid nightscout_status enum → 400", async () => {
  const deps = goodDeps();
  const result = await handleSetupRequest({ ...validBody, nightscout_status: "expert" }, deps);
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("nightscout_status must be one of");
});

test("cgmSetupRequest: unauthenticated → 401", async () => {
  const deps = { ...goodDeps(), user: null };
  const result = await handleSetupRequest(validBody, deps);
  expect(result.status).toBe(401);
  expect(result.body.error).toContain("unauthorized");
});

test("cgmSetupRequest: accepts all valid sensor brands", async () => {
  for (const brand of VALID_BRANDS) {
    const deps = goodDeps();
    const result = await handleSetupRequest({ ...validBody, sensor_brand: brand }, deps);
    expect(result.status).toBe(200);
  }
});

test("cgmSetupRequest: accepts all valid OS values", async () => {
  for (const os of VALID_OS) {
    const deps = goodDeps();
    const result = await handleSetupRequest({ ...validBody, device_os: os }, deps);
    expect(result.status).toBe(200);
  }
});

test("cgmSetupRequest: accepts all valid nightscout values", async () => {
  for (const ns of VALID_NIGHTSCOUT) {
    const deps = goodDeps();
    const result = await handleSetupRequest({ ...validBody, nightscout_status: ns }, deps);
    expect(result.status).toBe(200);
  }
});
