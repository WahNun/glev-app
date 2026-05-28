// End-to-end test for the hold-to-talk mic button in GlevAIChatSheet (Task #714).
//
// Why this exists:
//   The mic button in the AI chat sheet is the only voice entry point on the
//   app's main input row. Before this spec, a regression — the button
//   disappearing, the recording animation breaking, or the transcription route
//   returning an error — would be invisible until a user report surfaced it.
//
// What is tested (four sub-assertions, matching the task spec):
//   1. Mic button presence  — the button is visible in the chat sheet's
//      input row once the sheet is open.
//   2. Pulsing animation while recording — after pointerdown the button's
//      background flips to the accent colour (#4F6EF7) and the CSS animation
//      name becomes "glevBtnGlowFast …" (aria-pressed="true" as a fast proxy
//      for the isListening state; background/animation are checked too).
//   3. Transcript lands in the text field — after pointerup the hook calls
//      the transcription route (mocked here), and the returned text appears
//      inside the <input> next to the mic button.
//   4. Button returns to rest state — aria-pressed flips back to "false" and
//      the background returns to the dark idle colour.
//
// Two test cases:
//   A. SSE happy path: /api/transcribe/mistral/stream returns partial + final
//      SSE events; transcript arrives via the streaming path.
//   B. SSE→REST fallback: /api/transcribe/mistral/stream returns HTTP 500;
//      hook falls back to /api/transcribe/mistral (REST POST), transcript
//      arrives via the fallback path.
//
// How the browser APIs are mocked:
//   navigator.mediaDevices.getUserMedia — replaced by a synchronous fake that
//   returns a MediaStream-shaped stub (no actual mic permission dialog).
//   MediaRecorder — replaced by FakeMediaRecorder:
//     · start()  → emits a single ondataavailable event with a non-empty Blob
//                  (so the hook's chunk array is non-empty and the transcribe
//                  fetch is not skipped), then marks state="recording".
//     · stop()   → marks state="inactive" and fires onstop synchronously so
//                  the hook doesn't need to wait an arbitrary tick. Also stops
//                  the fake stream tracks.
//   /api/transcribe/mistral/stream  — intercepted by page.route() to return
//   SSE events (happy path) or HTTP 500 (fallback test).
//   /api/transcribe/mistral         — intercepted by page.route() to return
//   { text: "Hallo Test" } in the fallback test; routed but never called in
//   the happy-path test.
//   /api/ai/consent                 — intercepted to return { ok: true } so the
//   "Aktivieren →" button in the consent modal doesn't need a live Supabase row.
//
// Open-the-sheet flow:
//   The chat sheet lives in Layout.tsx and is gated behind ai_consent_at in
//   the profiles table. For a freshly provisioned test user the consent will
//   not be set, so the FAB click opens the consent modal first. The test
//   waits for EITHER the modal OR the sheet and handles both paths:
//     · if modal: click "Aktivieren →" → sheet opens optimistically
//     · if sheet already open: proceed directly
//   This keeps the test green whether the test user already has consent from
//   a previous run or not.

import { expect, test, type Page } from "@playwright/test";
import { loadTestUserByIndex } from "../support/testUser";

interface TestUser { email: string; password: string; userId: string; }


async function loginAsTestUser(page: Page, workerIndex: number) {
  const { email, password } = loadTestUserByIndex(workerIndex);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

/**
 * Injects a fake getUserMedia + FakeMediaRecorder into the page before any
 * scripts run. The fake MediaRecorder mirrors the interface used by
 * useVoxtral.ts — specifically:
 *   - static isTypeSupported() returning true for "audio/webm;codecs=opus"
 *   - ondataavailable / onstop callbacks set by the hook
 *   - start(timeslice) emitting one data chunk then setting state="recording"
 *   - stop() firing onstop synchronously after setting state="inactive"
 *
 * The Blob emitted by start() is non-empty (size > 0) so useVoxtral's guard
 *   `if (chunksRef.current.length === 0) return;`
 * does not short-circuit before reaching the fetch.
 */
async function injectMediaMocks(page: Page) {
  await page.addInitScript(() => {
    /* ── Fake MediaStream ─────────────────────────────────────────────── */
    const fakeStream = {
      getTracks: () => ([{ stop: () => {} }]),
    } as unknown as MediaStream;

    /* ── Fake getUserMedia ───────────────────────────────────────────── */
    const fakeMD = {
      getUserMedia: (_constraints: MediaStreamConstraints) =>
        Promise.resolve(fakeStream),
    } as unknown as MediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      get: () => fakeMD,
      configurable: true,
    });

    /* ── FakeMediaRecorder ───────────────────────────────────────────── */
    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm;codecs=opus" || type === "audio/webm";
      }
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: RecordingState = "inactive";

      constructor(
        _stream: MediaStream,
        _opts?: MediaRecorderOptions,
      ) {}

      start(_timeslice?: number) {
        this.state = "recording";
        // Emit one non-empty chunk so useVoxtral doesn't skip the fetch
        const chunk = new Blob(["fake-audio-data"], { type: "audio/webm" });
        if (this.ondataavailable) {
          this.ondataavailable({ data: chunk });
        }
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        // Fire onstop immediately (synchronous, like Chrome's native impl)
        if (this.onstop) {
          this.onstop();
        }
      }
    }

    // Replace the global MediaRecorder constructor
    (window as unknown as Record<string, unknown>)["MediaRecorder"] =
      FakeMediaRecorder;
  });
}

/**
 * Shared helper: open the AI chat sheet (handles consent modal if present).
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
 * Shared helper: assert mic button active state, then trigger stop and wait
 * for the transcript to appear in the chat input.
 */
async function assertRecordingAndTranscript(
  page: Page,
  chatDialog: ReturnType<Page["getByRole"]>,
  expectedTranscript: string,
) {
  const micBtn = page.getByRole("button", { name: /Spracheingabe starten|Aufnahme stoppen/i });
  await expect(micBtn).toBeVisible({ timeout: 10_000 });

  /* ── Assertion 1: button is present in rest state ─────────────────── */
  await expect(micBtn).toHaveAttribute("aria-pressed", "false");

  /* ── Assertion 2: animation / colour while recording ─────────────── */
  await micBtn.dispatchEvent("pointerdown", { bubbles: true, cancelable: true });

  await expect(micBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  const bgWhileListening = await micBtn.evaluate((el) =>
    window.getComputedStyle(el).backgroundColor,
  );
  expect(bgWhileListening).toBe("rgb(79, 110, 247)");

  const animWhileListening = await micBtn.evaluate((el) =>
    window.getComputedStyle(el).animationName,
  );
  expect(animWhileListening).toContain("glevBtnGlowFast");

  /* ── Assertion 3: transcript lands in the text input ─────────────── */
  await micBtn.dispatchEvent("pointerup", { bubbles: true });

  const chatInput = chatDialog.locator('input[type="text"]');
  await expect(chatInput).toHaveValue(expectedTranscript, { timeout: 8_000 });

  /* ── Assertion 4: button returns to rest state ────────────────────── */
  await expect(micBtn).toHaveAttribute("aria-pressed", "false");

  const bgAfterStop = await micBtn.evaluate((el) =>
    window.getComputedStyle(el).backgroundColor,
  );
  expect(bgAfterStop).toBe("rgb(33, 38, 45)");
}

test.describe("Hold-to-talk mic button in GlevAIChatSheet", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("SSE happy path: partial + final events arrive and transcript lands in input", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks (must be before navigation) ────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ──────────────────────────────────────────────── */

    // Mock the SSE streaming route — emit one partial event followed by a
    // final event. The hook should deliver the final text to the input.
    // Content-Type is text/event-stream so the hook's ReadableStream path runs.
    await page.route("**/api/transcribe/mistral/stream", async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: "partial", text: "Hallo" })}`,
        "",
        `data: ${JSON.stringify({ type: "final", text: "Hallo Test" })}`,
        "",
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody,
      });
    });

    // The REST fallback must NOT be reached on the happy path. Register a
    // handler that records whether it was called so we can assert it wasn't.
    let restFallbackCalled = false;
    await page.route("**/api/transcribe/mistral", async (route) => {
      restFallbackCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "SHOULD NOT BE USED" }),
      });
    });

    // Intercept the consent API
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

    /* ── 1. Login ─────────────────────────────────────────────────────── */
    await loginAsTestUser(page, test.info().workerIndex);

    /* ── 2. Open the Glev AI chat sheet ──────────────────────────────── */
    const chatDialog = await openChatSheet(page);

    /* ── 3–6. Assertions (presence, animation, transcript, rest state) ── */
    await assertRecordingAndTranscript(page, chatDialog, "Hallo Test");

    // Confirm the REST fallback was never triggered
    expect(restFallbackCalled).toBe(false);
  });

  test("SSE fallback path: HTTP 500 from SSE route causes hook to fall back to REST endpoint", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks ─────────────────────────────────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ──────────────────────────────────────────────── */

    // SSE route returns HTTP 500 — triggers the fallback branch in
    // transcribeWithFallback (res.ok is false → throws → catches → REST).
    await page.route("**/api/transcribe/mistral/stream", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "simulated SSE failure" }),
      });
    });

    // REST fallback route — should be called after the SSE failure
    let restFallbackCalled = false;
    await page.route("**/api/transcribe/mistral", async (route) => {
      restFallbackCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "Hallo Test" }),
      });
    });

    // Intercept the consent API
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

    /* ── 1. Login ─────────────────────────────────────────────────────── */
    await loginAsTestUser(page, test.info().workerIndex);

    /* ── 2. Open the Glev AI chat sheet ──────────────────────────────── */
    const chatDialog = await openChatSheet(page);

    /* ── 3–6. Assertions (presence, animation, transcript, rest state) ── */
    // The transcript should still arrive via the REST fallback
    await assertRecordingAndTranscript(page, chatDialog, "Hallo Test");

    // Confirm the fallback REST route was actually hit
    expect(restFallbackCalled).toBe(true);
  });
});
