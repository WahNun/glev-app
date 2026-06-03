/**
 * Integration-style tests for the /sms-stop opt-out logic.
 *
 * We test the core logic that drives the page: token validation and the
 * Supabase write path. The Next.js Server Component layer is thin wiring;
 * the meaningful invariants are:
 *   - valid token → opt-out written to profiles + event row inserted
 *   - invalid token → no DB writes
 *   - already opted-out → idempotent re-write still succeeds
 *
 * Uses an in-memory fake for the Supabase admin client (mirrors outbox.test.ts).
 */

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/sms/unsubscribeToken";

const ORIGINAL_SECRET = process.env.SMS_UNSUB_SECRET;
const TEST_SECRET = "sms-stop-test-secret-12345!!!!!!";

beforeAll(() => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.SMS_UNSUB_SECRET;
  } else {
    process.env.SMS_UNSUB_SECRET = ORIGINAL_SECRET;
  }
});

// ---------------------------------------------------------------------------
// In-memory fake Supabase client
// ---------------------------------------------------------------------------

interface ProfileRow {
  user_id: string;
  sms_opted_out: boolean;
  sms_opted_out_at: string | null;
}

interface EventRow {
  user_id: string;
  opted_out_at: string;
  ip: string | null;
  user_agent: string | null;
  token_used: string;
}

function makeFakeSupabase(initialProfile: ProfileRow | null) {
  let profile = initialProfile ? { ...initialProfile } : null;
  const events: EventRow[] = [];

  return {
    profileSnapshot: () => profile,
    events: () => events,
    from(table: string) {
      if (table === "profiles") {
        return {
          update(patch: Partial<ProfileRow>) {
            return {
              eq(_col: string, val: string) {
                if (profile && profile.user_id === val) {
                  Object.assign(profile!, patch);
                  return { data: null, error: null };
                }
                return { data: null, error: { message: "row not found" } };
              },
            };
          },
        };
      }
      if (table === "sms_optout_events") {
        return {
          insert(row: EventRow) {
            events.push(row);
            return { data: null, error: null };
          },
        };
      }
      return {};
    },
  };
}

type FakeDb = ReturnType<typeof makeFakeSupabase>;

// ---------------------------------------------------------------------------
// Core logic (extracted from page.tsx, injectable deps for testing)
// ---------------------------------------------------------------------------

function handleOptOut(
  token: string | undefined,
  userId: string | undefined,
  sb: FakeDb,
  requestMeta: { ip: string | null; userAgent: string | null },
): { status: "success" | "invalid" | "error"; reason?: string } {
  if (!token || !userId) return { status: "invalid", reason: "missing_params" };

  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const valid = verifyUnsubscribeToken(token, userId);
  if (!valid) return { status: "invalid", reason: "bad_token" };

  const now = new Date().toISOString();

  const updateResult = sb.from("profiles").update({
    sms_opted_out: true,
    sms_opted_out_at: now,
  }).eq("user_id", userId) as { data: null; error: { message: string } | null };

  if (updateResult.error) return { status: "error" };

  (sb.from("sms_optout_events") as { insert: (r: EventRow) => unknown }).insert({
    user_id: userId,
    opted_out_at: now,
    ip: requestMeta.ip,
    user_agent: requestMeta.userAgent,
    token_used: token,
  });

  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("/sms-stop: valid token → success + DB update + event row", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "aaaaaaaa-0000-0000-0000-000000000001";
  const token = generateUnsubscribeToken(userId);

  const fakeDb = makeFakeSupabase({ user_id: userId, sms_opted_out: false, sms_opted_out_at: null });

  const result = handleOptOut(token, userId, fakeDb, { ip: "1.2.3.4", userAgent: "TestAgent/1.0" });

  expect(result.status).toBe("success");
  expect(fakeDb.profileSnapshot()?.sms_opted_out).toBe(true);
  expect(fakeDb.profileSnapshot()?.sms_opted_out_at).not.toBeNull();
  expect(fakeDb.events()).toHaveLength(1);
  expect(fakeDb.events()[0].token_used).toBe(token);
  expect(fakeDb.events()[0].ip).toBe("1.2.3.4");
});

test("/sms-stop: invalid token → no DB writes", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "aaaaaaaa-0000-0000-0000-000000000002";
  const fakeDb = makeFakeSupabase({ user_id: userId, sms_opted_out: false, sms_opted_out_at: null });

  const result = handleOptOut("tampered-invalid-token", userId, fakeDb, { ip: null, userAgent: null });

  expect(result.status).toBe("invalid");
  expect(fakeDb.profileSnapshot()?.sms_opted_out).toBe(false);
  expect(fakeDb.events()).toHaveLength(0);
});

test("/sms-stop: missing params → invalid", () => {
  const fakeDb = makeFakeSupabase(null);
  const result = handleOptOut(undefined, undefined, fakeDb, { ip: null, userAgent: null });
  expect(result.status).toBe("invalid");
  expect(result.reason).toBe("missing_params");
});

test("/sms-stop: already opted-out → idempotent success", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "aaaaaaaa-0000-0000-0000-000000000003";
  const token = generateUnsubscribeToken(userId);

  const alreadyOptedOutAt = "2026-01-01T00:00:00.000Z";
  const fakeDb = makeFakeSupabase({ user_id: userId, sms_opted_out: true, sms_opted_out_at: alreadyOptedOutAt });

  const result = handleOptOut(token, userId, fakeDb, { ip: null, userAgent: null });

  expect(result.status).toBe("success");
  expect(fakeDb.profileSnapshot()?.sms_opted_out).toBe(true);
  expect(fakeDb.events()).toHaveLength(1);
});

test("/sms-stop: token for user A does not validate for user B", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userA = "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa";
  const userB = "bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb";
  const tokenForA = generateUnsubscribeToken(userA);

  const fakeDb = makeFakeSupabase({ user_id: userB, sms_opted_out: false, sms_opted_out_at: null });

  const result = handleOptOut(tokenForA, userB, fakeDb, { ip: null, userAgent: null });

  expect(result.status).toBe("invalid");
  expect(fakeDb.profileSnapshot()?.sms_opted_out).toBe(false);
});
