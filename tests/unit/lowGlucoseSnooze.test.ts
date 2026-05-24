/**
 * Unit tests for the snooze-counter logic in `lib/lowGlucoseAlarm.ts`.
 *
 * Covers:
 *   1. snoozeLowAlarm increments snoozeCount on each call.
 *   2. After MAX_SNOOZES consecutive snoozes the call is a no-op
 *      (counter stays at MAX_SNOOZES, localStorage untouched).
 *   3. resetSnoozeCount resets the counter back to 0.
 *   4. getSnoozeCount reflects the current in-memory state.
 *   5. isInSnoozeRecurrence returns correct state.
 *   6. fireLowGlucoseAlarm returns false when snooze limit reached
 *      (no window / SSR environment).
 *
 * Note: isBrowser() returns false in Node (no `window`), so
 * localStorage is never touched — the tests focus purely on the
 * counter / guard logic, which runs before the browser check.
 */

import { test, expect, beforeEach } from "@playwright/test";

import {
  snoozeLowAlarm,
  resetSnoozeCount,
  getSnoozeCount,
  isInSnoozeRecurrence,
  fireLowGlucoseAlarm,
  MAX_SNOOZES,
} from "@/lib/lowGlucoseAlarm";

beforeEach(() => {
  resetSnoozeCount();
});

test("snoozeCount starts at 0 after reset", () => {
  expect(getSnoozeCount()).toBe(0);
});

test("snoozeLowAlarm increments counter on each call", () => {
  snoozeLowAlarm(15);
  expect(getSnoozeCount()).toBe(1);
  snoozeLowAlarm(15);
  expect(getSnoozeCount()).toBe(2);
});

test("snoozeLowAlarm reaches MAX_SNOOZES after three calls", () => {
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  expect(getSnoozeCount()).toBe(MAX_SNOOZES);
});

test("fourth snoozeLowAlarm call is a no-op — counter stays at MAX_SNOOZES", () => {
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  snoozeLowAlarm(15); // must not increment
  expect(getSnoozeCount()).toBe(MAX_SNOOZES);
});

test("additional calls beyond MAX_SNOOZES all remain no-ops", () => {
  for (let i = 0; i < MAX_SNOOZES + 5; i++) {
    snoozeLowAlarm(15);
  }
  expect(getSnoozeCount()).toBe(MAX_SNOOZES);
});

test("resetSnoozeCount resets the counter to 0", () => {
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  resetSnoozeCount();
  expect(getSnoozeCount()).toBe(0);
});

test("snoozing is possible again after a reset", () => {
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  resetSnoozeCount();
  snoozeLowAlarm(15);
  expect(getSnoozeCount()).toBe(1);
});

test("MAX_SNOOZES constant is 3", () => {
  expect(MAX_SNOOZES).toBe(3);
});

test("isInSnoozeRecurrence returns false before any snooze", () => {
  expect(isInSnoozeRecurrence()).toBe(false);
});

test("isInSnoozeRecurrence returns true after first snooze", () => {
  snoozeLowAlarm(15);
  expect(isInSnoozeRecurrence()).toBe(true);
});

test("isInSnoozeRecurrence returns false again after reset", () => {
  snoozeLowAlarm(15);
  resetSnoozeCount();
  expect(isInSnoozeRecurrence()).toBe(false);
});

test("fireLowGlucoseAlarm returns false when snooze limit is exhausted (SSR/no-window)", async () => {
  // Exhaust all snoozes
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  snoozeLowAlarm(15);
  // In Node (no window), isBrowser() is false but the snooze guard fires
  // first — either way the result must be false.
  const result = await fireLowGlucoseAlarm({
    title: "Test",
    body: "Test body",
  });
  expect(result).toBe(false);
});
