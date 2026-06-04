// End-to-end tests for the STT error banner clear behaviour in GlevAIChatSheet.
//
// Why this exists:
//   Task #1146 fixed the "stuck error banner" bug (four targeted fixes: Reset
//   button, mic button pointerdown, submit(), and a 6-second auto-dismiss).
//   Without automated coverage a future refactor could silently re-introduce
//   the same regression. These tests lock in all four clearing paths.
//
// What is tested (four scenarios):
//   1. Chat Reset button — banner clears when the clockwise-arrow reset button
//      is clicked.
//   2. Mic button pointerdown — banner clears immediately when the user starts
//      a new recording attempt (before any transcript arrives).
//   3. Type + submit — banner clears when the user types text and submits via
//      Enter (or clicking Send).
//   4. Auto-dismiss — banner disappears on its own after 7 seconds without
//      any user interaction (auto-dismiss fires at 6 s).
//
// How the error state is injected:
//   GlevAIChatSheet exposes a test bridge:
//     window.__glevTestSetSttError(message: string | null)
//   This is a one-liner useEffect that sets/deletes a window property while
//   the sheet is mounted. Calling it is equivalent to the component receiving
//   an onError callback from useVoiceIntents — it sets the same sttError React
//   state without needing a real microphone or a live API failure.
//
// How the chat sheet is opened:
//   Same pattern as mic-button-hold-to-talk.spec.ts: FAB click → handle the
//   consent modal if present → wait for the dialog to become visible.
//
// Consent API:
//   Mocked to return { ok: true } so the "Aktivieren →" button works without
//   a live Supabase row.
//
// AI chat API:
//   Aborted via page.route() for the tests that submit a message. This avoids
//   a hanging network request, and because setSttError(null) runs synchronously
//   in submit() before onSend(), the banner is already gone by the time the
//   abort fires.
//
// Reset button disabled state:
//   The "Chat zurücksetzen" button is disabled when messages.length === 0 &&
//   !streaming. After an STT error with no prior messages the button is
//   disabled, so we lift the attribute via page.evaluate before clicking.
//   React's onClick handler is still wired and fires correctly on the
//   next synthetic click event.

import { expect, test, type Page } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

const STT_ERROR_MSG = "Transkription fehlgeschlagen";
const BANNER_TESTID = "[data-testid='stt-error-banner']";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to /dashboard. If not already logged in, perform a full login.
 * Also dismisses the BzCheckModal if it appears on first load, using the
 * keyboard-Escape strategy documented in .agents/memory/bzcheck-modal-playwright.md
 * (CSS-transform sheet: focus numeric input → Escape → wait 500ms for slide-out).
 */
async function ensureLoggedIn(page: Page, workerIndex: number): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded", timeout: 20_000 });

  if (
    page.url().includes("/login") ||
    page.url().includes("/onboarding") ||
    page.url() === "about:blank"
  ) {
    if (!page.url().includes("/login")) {
      await page.goto("/login");
    }

    const { email, password } = loadTestUserByIndex(workerIndex);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
      page.locator('button[type="submit"]').first().click(),
    ]);
  }

  // BzCheckModal can appear on first load for new test users. It confines
  // getByRole() scope to the dialog, making all out-of-modal elements
  // unreachable. Dismiss via focus + Escape (see bzcheck-modal-playwright.md).
  const bzDialog = page.locator('[role="dialog"][aria-modal="true"]');
  const dialogVisible = await bzDialog.isVisible({ timeout: 4_000 }).catch(() => false);
  if (dialogVisible) {
    const bzInput = bzDialog.locator('input[type="number"]');
    await bzInput.focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

/**
 * Open the Glev AI chat sheet. Handles the consent modal if present
 * (same logic as mic-button-hold-to-talk.spec.ts).
 */
async function openChatSheet(page: Page) {
  const fabHit = page.locator('[data-glev-fab-hit="true"]');
  await expect(fabHit).toBeVisible({ timeout: 30_000 });
  await fabHit.click();

  const activateBtn = page.getByRole("button", { name: /Aktivieren/i });
  const chatDialog = page.getByRole("dialog", { name: "Glev AI Chat" });

  await Promise.race([
    activateBtn.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
    chatDialog.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
  ]);

  const modalVisible = await activateBtn.isVisible().catch(() => false);
  if (modalVisible) {
    await activateBtn.click();
  }

  await expect(chatDialog).toBeVisible({ timeout: 15_000 });
  return chatDialog;
}

/**
 * Injects the STT error state into GlevAIChatSheet via the window test bridge
 * and asserts that the banner becomes visible before returning.
 */
async function injectError(page: Page, message = STT_ERROR_MSG) {
  await page.evaluate(
    (msg) => {
      const fn = (
        window as unknown as Record<string, unknown>
      )["__glevTestSetSttError"];
      if (typeof fn === "function") (fn as (m: string) => void)(msg);
    },
    message,
  );
  await expect(page.locator(BANNER_TESTID)).toBeVisible({ timeout: 3_000 });
}

/** Fake MediaRecorder so mic button tests don't need real hardware. */
async function injectMediaMocks(page: Page) {
  await page.addInitScript(() => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      get: () => ({
        getUserMedia: () => Promise.resolve(fakeStream),
      }),
      configurable: true,
    });

    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm;codecs=opus" || type === "audio/webm";
      }
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: RecordingState = "inactive";
      constructor(_s: MediaStream, _o?: MediaRecorderOptions) {}
      start(_timeslice?: number) {
        this.state = "recording";
        const chunk = new Blob(["x"], { type: "audio/webm" });
        this.ondataavailable?.({ data: chunk });
      }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.onstop?.();
      }
    }

    (window as unknown as Record<string, unknown>)["MediaRecorder"] =
      FakeMediaRecorder;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("STT error banner — clears on reset and retry", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    // Pre-accept cookie consent so the CookieBanner never blocks the login
    // form. CookieBanner reads localStorage("glev_cookie_consent") on mount;
    // if unset it renders the dialog over the page (see CookieBanner.tsx).
    // clearCookies() removes auth cookies but NOT localStorage, however we
    // call addInitScript here to ensure a clean state across all test runs.
    await context.addInitScript(() => {
      window.localStorage.setItem(
        "glev_cookie_consent",
        JSON.stringify({ v: 2, necessary: true, analytics: false, marketing: false }),
      );
    });
  });

  // ── Test 1: Chat Reset ───────────────────────────────────────────────────
  test("banner clears when Chat Reset button is pressed", async ({ page }) => {
    await page.route("**/api/ai/consent", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      } else {
        await route.continue();
      }
    });
    // Abort AI chat calls to prevent hanging requests
    await page.route("**/api/ai/chat", (route) => route.abort());

    await ensureLoggedIn(page, test.info().workerIndex);
    await openChatSheet(page);

    // Inject error and confirm banner is visible
    await injectError(page);

    // The Reset button is disabled when no messages exist.
    // Lift the attribute so the React onClick handler fires on click.
    await page.evaluate(() => {
      document
        .querySelector('[aria-label="Chat zurücksetzen"]')
        ?.removeAttribute("disabled");
    });

    await page.locator('[aria-label="Chat zurücksetzen"]').click();

    // Banner must be gone after reset
    await expect(page.locator(BANNER_TESTID)).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // ── Test 2: Mic button pointerdown ───────────────────────────────────────
  test("banner clears immediately when mic button is pressed (before recording completes)", async ({
    page,
  }) => {
    await injectMediaMocks(page);

    // Let the SSE route succeed so no second error is injected after pointerup
    await page.route("**/api/transcribe/mistral/stream", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ type: "final", text: "OK" })}\n\n`,
      });
    });
    await page.route("**/api/ai/consent", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route("**/api/ai/chat", (route) => route.abort());

    await ensureLoggedIn(page, test.info().workerIndex);
    await openChatSheet(page);

    // Inject error and confirm banner is visible
    await injectError(page);

    // Press mic button — setSttError(null) fires before startListening()
    const micBtn = page.locator('[data-glev-mic="true"]');
    await micBtn.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
    });

    // Banner must be gone immediately — before any recording result arrives
    await expect(page.locator(BANNER_TESTID)).not.toBeVisible({
      timeout: 2_000,
    });

    // Release mic to clean up (avoids leaving recording state open)
    await micBtn.dispatchEvent("pointerup", { bubbles: true });
  });

  // ── Test 3: Type + submit ────────────────────────────────────────────────
  test("banner clears when user types text and submits", async ({ page }) => {
    await page.route("**/api/ai/consent", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      } else {
        await route.continue();
      }
    });
    // Abort the AI chat request — setSttError(null) in submit() runs
    // synchronously before onSend() so the banner is cleared before the
    // network call even starts.
    await page.route("**/api/ai/chat", (route) => route.abort());

    await ensureLoggedIn(page, test.info().workerIndex);
    const chatDialog = await openChatSheet(page);

    // Inject error and confirm banner is visible
    await injectError(page);

    // Type text and press Enter — submit() calls setSttError(null) first
    const chatInput = chatDialog.locator('input[type="text"]');
    await chatInput.fill("Hallo");
    await chatInput.press("Enter");

    // Banner must be gone after submit
    await expect(page.locator(BANNER_TESTID)).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // ── Test 4: Auto-dismiss after 7 seconds ─────────────────────────────────
  test("banner auto-dismisses after 7 seconds without user interaction", async ({
    page,
  }) => {
    // 6-second auto-dismiss: wait 7 s → banner must be gone.
    // The timeout on this test is extended to allow the full wait.
    test.setTimeout(30_000);

    await page.route("**/api/ai/consent", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      } else {
        await route.continue();
      }
    });

    await ensureLoggedIn(page, test.info().workerIndex);
    await openChatSheet(page);

    // Inject error and confirm banner is visible
    await injectError(page);

    // Wait 7 s — auto-dismiss fires at 6 s via window.setTimeout in
    // the useEffect([sttError]) cleanup in GlevAIChatSheet.
    await page.waitForTimeout(7_100);

    // Banner must have auto-dismissed
    await expect(page.locator(BANNER_TESTID)).not.toBeVisible({
      timeout: 2_000,
    });
  });
});
