// Unit tests for extractTaskId in app/api/telegram/webhook/route.ts.
//
// The extractTaskId regex was silently broken for a long time (missing backtick
// support), so every format the outbound script produces must have explicit
// coverage here. Adding a new format to the script? Add a test case below.
//
// Coverage:
//   1. Backtick format — "🤖 Replit-Frage (Task `1234567890`)" → "1234567890"
//   2. Plain format    — "Task: 1234567890" → "1234567890"
//   3. Space format    — "Task 9876543210" → "9876543210"
//   4. Non-matching    — arbitrary text → null

import { test, expect } from "@playwright/test";
import { extractTaskId } from "@/app/api/telegram/webhook/route";

test("backtick format – extracts task id from standard outbound message", () => {
  const text = "🤖 Replit-Frage (Task `1234567890`)";
  expect(extractTaskId(text)).toBe("1234567890");
});

test("colon format – extracts task id from colon-separated prefix", () => {
  const text = "Task: 1234567890";
  expect(extractTaskId(text)).toBe("1234567890");
});

test("space format – extracts task id when no separator punctuation is present", () => {
  const text = "Task 9876543210";
  expect(extractTaskId(text)).toBe("9876543210");
});

test("embedded in longer reply – extracts task id from a realistic reply body", () => {
  const text =
    "Ja, Option A klingt gut.\n\n—\n🤖 Replit-Frage (Task `4430000000001`): Soll ich A oder B wählen?";
  expect(extractTaskId(text)).toBe("4430000000001");
});

test("non-matching text – returns null for unrelated messages", () => {
  expect(extractTaskId("Hallo, wie geht es dir?")).toBeNull();
});

test("non-matching text – returns null for empty string", () => {
  expect(extractTaskId("")).toBeNull();
});

test("non-matching text – returns null when 'task' appears without digits", () => {
  expect(extractTaskId("Task: no-digits-here")).toBeNull();
});
