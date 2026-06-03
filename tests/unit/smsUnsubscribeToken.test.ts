/**
 * Unit tests for lib/sms/unsubscribeToken.ts
 *
 * Tests:
 *  - valid round-trip: generateUnsubscribeToken / verifyUnsubscribeToken
 *  - tampered token returns false
 *  - different userId returns false
 *  - empty inputs return false (no throw)
 *  - different secret produces different, non-verifiable tokens
 *  - token signed with previous secret verifies during rotation window
 *  - token signed with previous secret fails once PREV is unset
 *  - token signed with an unknown old secret is always rejected
 */

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/sms/unsubscribeToken";

const ORIGINAL_SECRET = process.env.SMS_UNSUB_SECRET;
const ORIGINAL_PREV = process.env.SMS_UNSUB_SECRET_PREV;
const TEST_SECRET = "test-secret-for-unit-tests-32b!!";
const TEST_SECRET_PREV = "old-secret-before-rotation-32b!!";

beforeAll(() => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  delete process.env.SMS_UNSUB_SECRET_PREV;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.SMS_UNSUB_SECRET;
  } else {
    process.env.SMS_UNSUB_SECRET = ORIGINAL_SECRET;
  }
  if (ORIGINAL_PREV === undefined) {
    delete process.env.SMS_UNSUB_SECRET_PREV;
  } else {
    process.env.SMS_UNSUB_SECRET_PREV = ORIGINAL_PREV;
  }
});

test("generateUnsubscribeToken + verifyUnsubscribeToken: valid round-trip", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "550e8400-e29b-41d4-a716-446655440000";
  const token = generateUnsubscribeToken(userId);
  expect(typeof token).toBe("string");
  expect(token.length).toBeGreaterThan(10);
  expect(verifyUnsubscribeToken(token, userId)).toBe(true);
});

test("verifyUnsubscribeToken: tampered token returns false", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const token = generateUnsubscribeToken(userId);
  const tampered = token.slice(0, -3) + "XXX";
  expect(verifyUnsubscribeToken(tampered, userId)).toBe(false);
});

test("verifyUnsubscribeToken: different userId returns false", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "550e8400-e29b-41d4-a716-446655440002";
  const otherUserId = "550e8400-e29b-41d4-a716-446655440099";
  const token = generateUnsubscribeToken(userId);
  expect(verifyUnsubscribeToken(token, otherUserId)).toBe(false);
});

test("verifyUnsubscribeToken: empty token returns false without throwing", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  expect(verifyUnsubscribeToken("", "some-user-id")).toBe(false);
});

test("verifyUnsubscribeToken: same userId different secret produces non-matching token", () => {
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  const userId = "550e8400-e29b-41d4-a716-446655440003";
  const token = generateUnsubscribeToken(userId);

  process.env.SMS_UNSUB_SECRET = "completely-different-secret-!!!";
  const result = verifyUnsubscribeToken(token, userId);
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  expect(result).toBe(false);
});

// --- Secret rotation tests ---

test("rotation: token signed with previous secret verifies when PREV is set", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440010";

  // Simulate: token was generated before rotation
  process.env.SMS_UNSUB_SECRET = TEST_SECRET_PREV;
  const oldToken = generateUnsubscribeToken(userId);

  // Rotate: new secret active, old secret in PREV
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  process.env.SMS_UNSUB_SECRET_PREV = TEST_SECRET_PREV;

  expect(verifyUnsubscribeToken(oldToken, userId)).toBe(true);

  delete process.env.SMS_UNSUB_SECRET_PREV;
});

test("rotation: token signed with current secret still verifies when PREV is also set", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440011";

  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  process.env.SMS_UNSUB_SECRET_PREV = TEST_SECRET_PREV;

  const currentToken = generateUnsubscribeToken(userId);
  expect(verifyUnsubscribeToken(currentToken, userId)).toBe(true);

  delete process.env.SMS_UNSUB_SECRET_PREV;
});

test("rotation: old token fails once PREV is removed after rotation window", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440012";

  // Simulate: token was generated before rotation
  process.env.SMS_UNSUB_SECRET = TEST_SECRET_PREV;
  const oldToken = generateUnsubscribeToken(userId);

  // New secret active, PREV cleared (rotation window over)
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  delete process.env.SMS_UNSUB_SECRET_PREV;

  expect(verifyUnsubscribeToken(oldToken, userId)).toBe(false);
});

test("rotation: token from unknown old secret is rejected even when PREV is set", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440013";
  const unknownSecret = "some-secret-we-never-configured-!!";

  // Token signed with a secret that was never registered
  process.env.SMS_UNSUB_SECRET = unknownSecret;
  const unknownToken = generateUnsubscribeToken(userId);

  // Active secret is TEST_SECRET, PREV is TEST_SECRET_PREV — neither matches
  process.env.SMS_UNSUB_SECRET = TEST_SECRET;
  process.env.SMS_UNSUB_SECRET_PREV = TEST_SECRET_PREV;

  expect(verifyUnsubscribeToken(unknownToken, userId)).toBe(false);

  delete process.env.SMS_UNSUB_SECRET_PREV;
});
