// Integration test for GET /sms-stop — SMS Opt-Out Landing Page
//
// Why this spec exists:
//   The unit tests in tests/unit/smsStopPage.test.ts exercise the pure logic
//   with a fake Supabase client. This spec hits the *real* running Next.js
//   dev server, asserting HTTP status codes (200 / 400) and verifying that
//   the actual Supabase DB is updated on a valid opt-out request.
//
// What this asserts:
//   1. Missing params → HTTP 400 with "Ungültiger Link" in body.
//   2. Invalid / tampered token → HTTP 400.
//   3. Valid token for the provisioned test user → HTTP 200, body contains
//      "abgemeldet", profiles.sms_opted_out flipped to true, and one row
//      inserted in sms_optout_events.
//   4. Second request with same valid token → idempotent HTTP 200 (upsert).
//
// The test generates the HMAC token in-process using the same
// SMS_UNSUB_SECRET that the dev server reads, so no extra endpoint is needed.
//
// SMS_UNSUB_SECRET must be set in the test environment (it is in .env.local).
// If the secret is absent, the test is skipped with a clear message rather
// than failing with a misleading error.

import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";

import type { TestUserCredentials } from "../support/testUser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadTestUser(): TestUserCredentials {
  const fixture = path.join(__dirname, "../.cache/test-user.json");
  return JSON.parse(fs.readFileSync(fixture, "utf8")) as TestUserCredentials;
}

function makeToken(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("GET /sms-stop — integration", () => {
  const secret = process.env.SMS_UNSUB_SECRET ?? "";

  test.beforeEach(async () => {
    if (!secret) test.skip(); // skip gracefully when secret not configured
  });

  test("missing params → HTTP 400 with 'Ungültiger Link'", async ({ request }) => {
    const res = await request.get("/sms-stop");
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("Ungültiger Link");
  });

  test("invalid token → HTTP 400", async ({ request }) => {
    const { userId } = loadTestUser();
    const res = await request.get(`/sms-stop?t=BADTOKEN&u=${userId}`);
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("Ungültiger Link");
  });

  test("token for wrong user → HTTP 400", async ({ request }) => {
    const { userId } = loadTestUser();
    const wrongToken = makeToken(secret, "00000000-0000-0000-0000-000000000000");
    const res = await request.get(`/sms-stop?t=${wrongToken}&u=${userId}`);
    expect(res.status()).toBe(400);
  });

  test("valid token → HTTP 200 + DB updated + audit row inserted", async ({ request }) => {
    const { userId } = loadTestUser();
    const token = makeToken(secret, userId);
    const sb    = supabaseAdmin();

    // Reset opt-out so the test is repeatable.
    await sb.from("profiles")
      .update({ sms_opted_out: false, sms_opted_out_at: null })
      .eq("user_id", userId);
    await sb.from("sms_optout_events").delete().eq("user_id", userId);

    const res = await request.get(`/sms-stop?t=${token}&u=${userId}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("abgemeldet");

    // profiles.sms_opted_out must be true
    const { data: profile } = await sb
      .from("profiles")
      .select("sms_opted_out, sms_opted_out_at")
      .eq("user_id", userId)
      .single();
    expect(profile?.sms_opted_out).toBe(true);
    expect(profile?.sms_opted_out_at).not.toBeNull();

    // sms_optout_events must have exactly one row
    const { data: events } = await sb
      .from("sms_optout_events")
      .select("token_used")
      .eq("user_id", userId);
    expect(events).toHaveLength(1);
    expect(events![0].token_used).toBe(token);

    // Cleanup so other tests aren't affected
    await sb.from("profiles")
      .update({ sms_opted_out: false, sms_opted_out_at: null })
      .eq("user_id", userId);
    await sb.from("sms_optout_events").delete().eq("user_id", userId);
  });

  test("valid token called twice → idempotent HTTP 200", async ({ request }) => {
    const { userId } = loadTestUser();
    const token = makeToken(secret, userId);
    const sb    = supabaseAdmin();

    // Ensure clean state
    await sb.from("profiles")
      .update({ sms_opted_out: false, sms_opted_out_at: null })
      .eq("user_id", userId);
    await sb.from("sms_optout_events").delete().eq("user_id", userId);

    const res1 = await request.get(`/sms-stop?t=${token}&u=${userId}`);
    expect(res1.status()).toBe(200);

    const res2 = await request.get(`/sms-stop?t=${token}&u=${userId}`);
    expect(res2.status()).toBe(200);

    // Cleanup
    await sb.from("profiles")
      .update({ sms_opted_out: false, sms_opted_out_at: null })
      .eq("user_id", userId);
    await sb.from("sms_optout_events").delete().eq("user_id", userId);
  });
});
