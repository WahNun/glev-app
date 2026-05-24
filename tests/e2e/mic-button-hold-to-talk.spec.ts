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
//      /api/transcribe/mistral (mocked here), and the returned text appears
//      inside the <input> next to the mic button.
//   4. Button returns to rest state — aria-pressed flips back to "false" and
//      the background returns to the dark idle colour.
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
//   /api/transcribe/mistral  — intercepted by page.route() to return
//   { text: "Hallo Test" } instantly, removing the real Mistral round-trip.
//   /api/ai/consent          — intercepted to return { ok: true } so the
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
import fs from "node:fs";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

async function loginAsTestUser(page: Page) {
  const { email, password } = loadTestUser();
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

test.describe("Hold-to-talk mic button in GlevAIChatSheet", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("mic button is present, triggers recording animation, and delivers transcript to input", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks (must be before navigation) ────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ──────────────────────────────────────────────── */
    // Intercept the STT route so no real Mistral call is made
    await page.route("**/api/transcribe/mistral", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "Hallo Test" }),
      });
    });

    // Intercept the consent API so "Aktivieren →" succeeds even without
    // a live Supabase profiles row
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
    await loginAsTestUser(page);

    /* ── 2. Open the Glev AI chat sheet ──────────────────────────────── */
    // The FAB hit-area is a position:fixed button rendered in every layout.
    // Clicking it either opens the consent modal (first visit) or directly
    // opens the sheet (if consent was already granted in a prior run).
    const fabHit = page.locator('[data-glev-fab-hit="true"]');
    await expect(fabHit).toBeVisible({ timeout: 30_000 });
    await fabHit.click();

    // Consent modal — shown when ai_consent_at is not yet set
    const activateBtn = page.getByRole("button", { name: /Aktivieren/i });
    const chatDialog = page.getByRole("dialog", { name: "Glev AI Chat" });

    // Wait for either the consent modal button or the chat dialog, whichever
    // appears first. The race() approach avoids a fixed timeout guess.
    await Promise.race([
      activateBtn.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
      chatDialog.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
    ]);

    const modalVisible = await activateBtn.isVisible().catch(() => false);
    if (modalVisible) {
      await activateBtn.click();
    }

    // Now the chat sheet must be visible
    await expect(chatDialog).toBeVisible({ timeout: 15_000 });

    /* ── 3. Assertion 1: mic button is present ────────────────────────── */
    const micBtn = page.getByRole("button", { name: /Spracheingabe starten|Aufnahme stoppen/i });
    await expect(micBtn).toBeVisible({ timeout: 10_000 });

    // Confirm initial rest state
    await expect(micBtn).toHaveAttribute("aria-pressed", "false");

    /* ── 4. Assertion 2: animation / colour while recording ───────────── */
    // pointerdown starts listening; we must NOT fire pointerup until after
    // we've asserted the active state.
    await micBtn.dispatchEvent("pointerdown", { bubbles: true, cancelable: true });

    // aria-pressed flips to "true" once React re-renders with isListening=true
    await expect(micBtn).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

    // Background colour switches to the accent colour (#4F6EF7) while active
    const bgWhileListening = await micBtn.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor,
    );
    // The accent hex #4F6EF7 maps to rgb(79, 110, 247) in computed styles
    expect(bgWhileListening).toBe("rgb(79, 110, 247)");

    // The pulsing keyframe animation is applied while isListening=true
    const animWhileListening = await micBtn.evaluate((el) =>
      window.getComputedStyle(el).animationName,
    );
    expect(animWhileListening).toContain("glevBtnGlowFast");

    /* ── 5. Assertion 3: transcript lands in the text input ───────────── */
    // pointerup → stopListening() → MediaRecorder.stop() → onstop fires →
    // transcribe route called (mocked) → onTranscript("Hallo Test") →
    // setInput("Hallo Test") in GlevAIChatSheet
    await micBtn.dispatchEvent("pointerup", { bubbles: true });

    const chatInput = chatDialog.locator('input[type="text"]');
    await expect(chatInput).toHaveValue("Hallo Test", { timeout: 8_000 });

    /* ── 6. Assertion 4: button returns to rest state ─────────────────── */
    await expect(micBtn).toHaveAttribute("aria-pressed", "false");

    const bgAfterStop = await micBtn.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor,
    );
    // Idle colour is #21262d → rgb(33, 38, 45)
    expect(bgAfterStop).toBe("rgb(33, 38, 45)");
  });
});
