/**
 * Unit tests for lib/sms/unsubscribeToken.ts
 *
 * Tests:
 *  - valid round-trip: generateUnsubscribeToken / verifyUnsubscribeToken
 *  - tampered token returns false
 *  - different userId returns false
 *  - empty inputs return false (no throw)
 *  - different secret produces different, non-verifiable tokens
 */

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/sms/unsubscribeToken";

const ORIGINAL_SECRET = process.env.SMS_UNSUB_SECRET;
const TEST_SECRET = "test-secret-for-unit-tests-32b!!";

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
