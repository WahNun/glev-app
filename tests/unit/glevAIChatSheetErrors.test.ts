import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const SHEET_SRC = readFileSync(
  join(process.cwd(), "components/GlevAIChatSheet.tsx"),
  "utf-8",
);

const HOOK_SRC = readFileSync(
  join(process.cwd(), "lib/useGlevAI.ts"),
  "utf-8",
);

/**
 * Component + hook contract tests — verify GlevAIChatSheet renders
 * user-friendly error content and gates the retry button on
 * the retryAllowed flag set by useGlevAI.
 */

test("GlevAIChatSheet: retry button is only rendered when m.retryAllowed is true", () => {
  // The component must check m.retryAllowed before rendering the retry button
  expect(SHEET_SRC).toContain("m.retryAllowed");

  // The condition must also ensure the message is no longer streaming
  expect(SHEET_SRC).toContain("!m.isStreaming");

  // When there is no prior user message the button must not appear
  expect(SHEET_SRC).toContain("if (!prevUser) return null");

  // The retry button re-sends the previous user message verbatim
  expect(SHEET_SRC).toContain("onSend(prevUser.content)");
});

test("GlevAIChatSheet: message bubble renders m.content (path for getUserFriendlyMessage output)", () => {
  // The component renders m.content as the bubble text, which useGlevAI sets
  // via getUserFriendlyMessage() — so friendly error copy reaches the UI.
  expect(SHEET_SRC).toContain("m.content");

  // The component must NOT embed raw technical error strings directly —
  // those are only produced by the old hook path that was replaced.
  expect(SHEET_SRC).not.toMatch(/Da ist etwas schiefgelaufen:/);
  expect(SHEET_SRC).not.toMatch(/Something went wrong:/);
});

test("useGlevAI: network errors (no error_code, e.g. fetch failed) resolve to UNKNOWN friendly message", () => {
  // The outer catch(e) block must NEVER fall back to e.message directly.
  // Old pattern: "e instanceof Error && e.message ? e.message : getUserFriendlyMessage(...)"
  // would surface "fetch failed" / "Failed to fetch" / "NetworkError" to users.
  // New pattern: always calls getUserFriendlyMessage(code, locale) where code
  // defaults to "UNKNOWN" when no error_code is attached to the thrown error.
  expect(HOOK_SRC).not.toMatch(/e instanceof Error && e\.message[\s\S]{0,20}\? e\.message/);

  // The catch block must use ALL_ERROR_CODES to validate the code before using it
  expect(HOOK_SRC).toContain("ALL_ERROR_CODES.includes(rawCode as AppErrorCode)");

  // The resolved message must always come from getUserFriendlyMessage, never raw e.message
  expect(HOOK_SRC).toContain('const msg = getUserFriendlyMessage(code, locale);');
});
