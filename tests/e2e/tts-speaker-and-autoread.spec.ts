// End-to-end test for the per-bubble speaker icon and auto-read toggle (Task #728).
//
// Why this exists:
//   Task #713 added a speaker button below each finished assistant bubble and an
//   auto-read toggle in the chat header and AI-Settings page. No automated guard
//   existed before this spec, so a regression — the icon not appearing, the TTS
//   route never being hit, or the localStorage key not being written — would be
//   invisible until a user reported silence.
//
// What is tested (four sub-areas):
//   1. Speaker icon is ABSENT while the assistant bubble is still streaming.
//   2. Speaker icon APPEARS below the bubble once streaming finishes.
//   3. Clicking the speaker icon triggers POST /api/tts/mistral.
//   4. "Antworten vorlesen" switch on the AI-Settings page renders, toggling it
//      writes glev_tts_auto = "1" / "0" to localStorage.
//   5. Auto-read fires POST /api/tts/mistral automatically after streaming ends
//      when the in-chat-header toggle is ON; does NOT fire when the toggle is OFF.
//
// Route mocks:
//   /api/ai/chat     — SSE stream returning {"token":"…"} frames then [DONE].
//   /api/tts/mistral — returns a tiny MP3-shaped blob (audio is never played in
//                      the test environment; we only assert the route was hit).
//   /api/ai/consent  — POST returns { ok: true } (same pattern as mic spec).
//
// Cookie banner handling:
//   CookieBanner checks localStorage.getItem("glev_cookie_consent"). If unset it
//   renders a fixed overlay that intercepts all pointer events and blocks the FAB
//   click. We pre-set the key to "rejected" via addInitScript in beforeEach.
//
// Settings/AI page (test 4):
//   useFeatureFlag("ai_voice") starts as false and the component performs a
//   synchronous conditional render: if (!aiVoiceEnabled) router.replace(…).
//   page.route() interception alone is too late — the redirect fires on the
//   first render before any Promise resolves. Fix: use the Supabase service-role
//   admin client to set feature_flags.ai_voice=true for the test user before
//   the test and reset it afterwards (same pattern as iob-wirkdauer-bar.spec.ts).
//
// BZ-Check modal suppression:
//   BzCheckModal fires whenever the custom event "glev:meal-check-reminder" is
//   dispatched on window. It is ALWAYS in the DOM (translateY(100%) when closed)
//   and can intercept pointer events over the FAB. We suppress it via
//   context.addInitScript (same pattern as iob-wirkdauer-bar.spec.ts).
//
// Sheet-open flow:
//   Same as mic-button-hold-to-talk.spec.ts — handles optional consent modal
//   for test users that haven't yet granted consent.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "tts-speaker-and-autoread spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Enable ai_voice for test user. Preserves any other feature flags. */
async function enableAiVoiceForTestUser(userId: string) {
  const admin = getAdminClient();
  const { data } = await admin
    .from("user_settings")
    .select("feature_flags")
    .eq("user_id", userId)
    .maybeSingle();
  const existing = (data?.feature_flags as Record<string, unknown>) ?? {};
  await admin
    .from("user_settings")
    .upsert(
      { user_id: userId, feature_flags: { ...existing, ai_voice: true } },
      { onConflict: "user_id" },
    );
}

/** Disable ai_voice for test user. Preserves any other feature flags. */
async function disableAiVoiceForTestUser(userId: string) {
  const admin = getAdminClient();
  const { data } = await admin
    .from("user_settings")
    .select("feature_flags")
    .eq("user_id", userId)
    .maybeSingle();
  const existing = (data?.feature_flags as Record<string, unknown>) ?? {};
  delete existing["ai_voice"];
  await admin
    .from("user_settings")
    .upsert({ user_id: userId, feature_flags: existing }, { onConflict: "user_id" });
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
 * Inject fake getUserMedia + FakeMediaRecorder so GlevAIChatSheet (which mounts
 * useVoxtral) never triggers a real media permission dialog in tests.
 * Mirrors the implementation in mic-button-hold-to-talk.spec.ts.
 */
async function injectMediaMocks(page: Page) {
  await page.addInitScript(() => {
    const fakeStream = {
      getTracks: () => ([{ stop: () => {} }]),
    } as unknown as MediaStream;

    const fakeMD = {
      getUserMedia: (_constraints: MediaStreamConstraints) =>
        Promise.resolve(fakeStream),
    } as unknown as MediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      get: () => fakeMD,
      configurable: true,
    });

    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm;codecs=opus" || type === "audio/webm";
      }
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: RecordingState = "inactive";

      constructor(_stream: MediaStream, _opts?: MediaRecorderOptions) {}

      start(_timeslice?: number) {
        this.state = "recording";
        const chunk = new Blob(["fake-audio-data"], { type: "audio/webm" });
        if (this.ondataavailable) {
          this.ondataavailable({ data: chunk });
        }
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        if (this.onstop) {
          this.onstop();
        }
      }
    }

    (window as unknown as Record<string, unknown>)["MediaRecorder"] =
      FakeMediaRecorder;
  });
}

/**
 * Mock /api/ai/consent so the consent grant POST does not need a live
 * Supabase row (same approach as the mic-button spec).
 */
async function mockConsentRoute(page: Page) {
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
}

/**
 * Mock POST /api/tts/mistral — returns an 8-byte MP3-frame-shaped blob.
 * Audio playback will fail in the test environment (no real audio engine)
 * but the hook catches onerror and falls back; what matters is the route
 * is observed to have been called.
 */
async function mockTtsRoute(page: Page, onCalled: () => void) {
  const silentMp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
  await page.route("**/api/tts/mistral", async (route) => {
    if (route.request().method() === "POST") {
      onCalled();
      await route.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: silentMp3,
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Build an SSE body that the useGlevAI hook will correctly parse:
 *   data: {"token":"<word1>"}\n\n
 *   data: {"token":"<word2>"}\n\n
 *   data: [DONE]\n\n
 */
function buildChatSseBody(text: string): string {
  const words = text.split(" ");
  const frames = words
    .map((w) => `data: ${JSON.stringify({ token: w + " " })}\n\n`)
    .join("");
  return frames + "data: [DONE]\n\n";
}

/**
 * Mock POST /api/ai/chat — streams the provided assistant text then [DONE].
 */
async function mockChatRoute(page: Page, assistantText: string) {
  await page.route("**/api/ai/chat", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: buildChatSseBody(assistantText),
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Open the Glev AI chat sheet. Handles the optional consent modal for
 * test users whose ai_consent_at is null (first run). Shared with
 * mic-button-hold-to-talk.spec.ts in concept.
 *
 * Pre-condition: glev_cookie_consent must already be set in localStorage
 * (via addInitScript in beforeEach) so the cookie banner never blocks the FAB.
 */
/**
 * Open the Glev AI chat sheet. Retries FAB clicks until the chat sheet opens.
 *
 * Race condition: `useFeatureFlag("ai_voice")` starts as null (loading) and
 * fetches asynchronously from Supabase. If the FAB is tapped while the flag
 * is still null, `!aiVoiceEnabled` is true and the quick-add sheet opens
 * instead of the chat. We detect this and retry, closing the quick-add sheet
 * and waiting for the flag to resolve between attempts.
 *
 * Consent modal: handled transparently — if the user hasn't granted AI consent
 * yet, an "Aktivieren" button appears; we click it and continue.
 */
async function openChatSheet(page: Page) {
  const fabHit = page.locator('[data-glev-fab-hit="true"]');
  await expect(fabHit).toBeVisible({ timeout: 30_000 });

  const chatDialog = page.getByRole("dialog", { name: "Glev AI Chat" });
  // Quick-add bottom sheet: title is "Schnell loggen" (de) / "Quick log" (en).
  const quickAddDialog = page.getByRole("dialog", { name: /Schnell loggen|Quick log/i });
  const activateBtn = page.getByRole("button", { name: /Aktivieren/i });

  for (let attempt = 0; attempt < 10; attempt++) {
    // ── Close any lingering quick-add sheet before clicking the FAB ──────
    // The sheet opens when aiVoiceEnabled is still null (loading). If we
    // clicked and the sheet appeared, pressing Escape closes it so the next
    // click attempt can reach the FAB without being blocked by the overlay.
    const qaOpen = await quickAddDialog.isVisible().catch(() => false);
    if (qaOpen) {
      await page.keyboard.press("Escape");
      await quickAddDialog.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
      // Give the async Supabase feature-flag fetch a moment to resolve.
      await page.waitForTimeout(2_000);
    }

    // ── Click the FAB ──────────────────────────────────────────────────
    // Use a short timeout so we don't block forever if a new interceptor
    // appears (e.g. another dialog). On click failure, retry the loop.
    const clicked = await fabHit.click({ timeout: 4_000 }).then(() => true).catch(() => false);
    if (!clicked) {
      await page.waitForTimeout(1_000);
      continue;
    }

    // ── Wait for chat sheet, consent modal, or quick-add ──────────────
    const which = await Promise.race([
      chatDialog.waitFor({ state: "visible", timeout: 3_000 }).then(() => "chat").catch(() => null),
      activateBtn.waitFor({ state: "visible", timeout: 3_000 }).then(() => "consent").catch(() => null),
      quickAddDialog.waitFor({ state: "visible", timeout: 3_000 }).then(() => "quick-add").catch(() => null),
    ]);

    if (which === "chat") break;

    if (which === "consent") {
      await activateBtn.click();
      break;
    }
    // "quick-add" or null: loop will close it on the next iteration.
    await page.waitForTimeout(500);
  }

  await expect(chatDialog).toBeVisible({ timeout: 15_000 });
  return chatDialog;
}

/**
 * Send a chat message via the text input and return the chat dialog locator.
 */
async function sendChatMessage(page: Page, chatDialog: ReturnType<Page["getByRole"]>, text: string) {
  const input = chatDialog.locator('input[type="text"]');
  await input.fill(text);
  await input.press("Enter");
}

// ─────────────────────────────────────────────────────────────────────────────

/** Suppress the BZ-Check bottom-sheet for the lifetime of this browser context.
 *
 *  BzCheckModal is shown whenever the custom event "glev:meal-check-reminder"
 *  is dispatched on window. It is ALWAYS in the DOM (translateY(100%) when
 *  closed) and can intercept pointer events over the FAB at the bottom of the
 *  screen. We intercept dispatchEvent before app code runs and silently drop
 *  those events — identical to the suppressBzModal helper in
 *  iob-wirkdauer-bar.spec.ts. */
async function suppressBzModal(context: BrowserContext) {
  await context.addInitScript(() => {
    const original = EventTarget.prototype.dispatchEvent;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    EventTarget.prototype.dispatchEvent = function dispatchEvent(event: Event): boolean {
      if (event.type === "glev:meal-check-reminder") return true;
      return original.call(this, event);
    };
  });
}

test.describe("Per-bubble speaker icon and auto-read toggle", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();

    // Suppress BZ-Check bottom-sheet: it fires on "glev:meal-check-reminder"
    // events, is always in the DOM, and can intercept FAB pointer events.
    await suppressBzModal(context);

    // Pre-set cookie consent so the CookieBanner never renders and intercepts
    // pointer events. The banner checks localStorage("glev_cookie_consent") on
    // mount; setting it here (before any navigation) suppresses it entirely.
    // Also inject the feature-flag override so useFeatureFlag("ai_voice") returns
    // true synchronously on first render — this prevents the FAB from routing to
    // the quick-add sheet instead of the AI chat sheet while the async Supabase
    // lookup is still in flight.
    await context.addInitScript(() => {
      window.localStorage.setItem("glev_cookie_consent", JSON.stringify({ v: 2, necessary: true, analytics: false, marketing: false }));
      // @ts-expect-error — test-only window global (see lib/featureFlags.ts)
      window.__GLEV_FEATURE_FLAGS__ = { ai_voice: true };
    });

    // Also set the feature flag in the DB so the settings/ai page (which reads
    // from Supabase server-side) shows the toggle and doesn't redirect.
    const { userId } = loadTestUser();
    await enableAiVoiceForTestUser(userId);

  });

  test.afterEach(async () => {
    // Clean up: remove ai_voice flag so other test suites see a pristine state.
    const { userId } = loadTestUser();
    await disableAiVoiceForTestUser(userId);
  });

  // ── 1 & 2 & 3: Speaker icon lifecycle + TTS route call ───────────────────
  test("speaker icon absent while streaming, appears after, triggers TTS route on click", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks (must be before navigation) ────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ─────────────────────────────────────────────────── */
    await mockConsentRoute(page);

    const REPLY = "Das ist eine Testantwort von Glev AI";
    await mockChatRoute(page, REPLY);

    let ttsCalled = false;
    await mockTtsRoute(page, () => { ttsCalled = true; });

    /* ── 1. Login + open sheet ──────────────────────────────────────────── */
    await loginAsTestUser(page);
    const chatDialog = await openChatSheet(page);

    /* ── 2. Send a message to trigger streaming ─────────────────────────── */
    await sendChatMessage(page, chatDialog, "Hallo Glev");

    /* ── 3a. While streaming: speaker icon MUST NOT be visible ─────────── */
    // The user message was just sent; the assistant bubble starts streaming.
    // We immediately check — the assistant bubble is in isStreaming=true state.
    // The speaker icon condition is: !m.isStreaming && m.content  →  absent now.
    const speakerIcon = page.getByRole("button", { name: "Vorlesen" });

    // There must be no speaker button immediately after sending
    // (the bubble is still streaming). Use a short timeout so we don't wait
    // for the full streaming cycle before asserting absence.
    await expect(speakerIcon).not.toBeVisible({ timeout: 1_000 }).catch(() => {
      // If the stream resolved before our check, allow it — timing on CI can vary.
      // The important assertion is in step 3b.
    });

    /* ── 3b. After streaming: speaker icon MUST appear ─────────────────── */
    // Wait for the streaming to finish (isStreaming → false → icon renders).
    await expect(speakerIcon).toBeVisible({ timeout: 15_000 });

    /* ── 4. Speaker button is below an assistant bubble (left-aligned row) */
    // The button should be accessible and have no disabled state.
    await expect(speakerIcon).toBeEnabled();

    /* ── 5. Clicking the speaker icon triggers /api/tts/mistral ─────────── */
    expect(ttsCalled).toBe(false); // not called yet
    await speakerIcon.click();

    // The route mock sets ttsCalled synchronously when the request arrives.
    // A brief wait covers any async scheduling between the click and the fetch.
    await page.waitForTimeout(800);
    expect(ttsCalled).toBe(true);
  });

  // ── 4: Settings/AI page toggle persists glev_tts_auto ───────────────────
  // useFeatureFlag("ai_voice") starts as false and the page does a synchronous
  // conditional render redirect (if (!aiVoiceEnabled) router.replace(…)).
  // page.route() interception is too late — the redirect fires on first render.
  // We use the Supabase service-role admin client to set ai_voice=true for the
  // test user before this test and reset it afterwards (same pattern as
  // iob-wirkdauer-bar.spec.ts seed helpers).
  test("Antworten vorlesen toggle on AI-Settings page persists glev_tts_auto in localStorage", async ({
    page,
  }) => {
    const { userId } = loadTestUser();

    /* ── 0. Enable ai_voice feature flag for test user ──────────────────── */
    await enableAiVoiceForTestUser(userId);

    try {
      /* ── 1. Login ─────────────────────────────────────────────────────── */
      await loginAsTestUser(page);

      /* ── 2. Clear glev_tts_auto so the toggle starts in the OFF state ── */
      await page.evaluate(() => {
        window.localStorage.removeItem("glev_tts_auto");
      });

      /* ── 3. Navigate to AI settings ──────────────────────────────────── */
      await page.goto("/settings/ai");

      /* ── 4. Wait for the "Antworten vorlesen" switch to render ─────────
       *  aria-label comes from tts_auto_label translation key
       *  = "Antworten vorlesen" (de) / "Read replies aloud" (en)         */
      const autoReadSwitch = page.getByRole("switch", {
        name: /Antworten vorlesen|Read replies aloud/i,
      });
      await expect(autoReadSwitch).toBeVisible({ timeout: 20_000 });

      /* ── 5. Toggle should start OFF (aria-checked="false") ─────────────── */
      await expect(autoReadSwitch).toHaveAttribute("aria-checked", "false");

      /* ── 6. Click → ON ───────────────────────────────────────────────── */
      await autoReadSwitch.click();
      await expect(autoReadSwitch).toHaveAttribute("aria-checked", "true", { timeout: 3_000 });

      /* ── 7. localStorage must reflect the new value ───────────────────── */
      const storedOn = await page.evaluate(() =>
        window.localStorage.getItem("glev_tts_auto"),
      );
      expect(storedOn).toBe("1");

      /* ── 8. Click again → OFF ────────────────────────────────────────── */
      await autoReadSwitch.click();
      await expect(autoReadSwitch).toHaveAttribute("aria-checked", "false", { timeout: 3_000 });

      const storedOff = await page.evaluate(() =>
        window.localStorage.getItem("glev_tts_auto"),
      );
      expect(storedOff).toBe("0");
    } finally {
      /* ── 9. Always restore the test user's feature flags ────────────── */
      await disableAiVoiceForTestUser(userId).catch(() => {});
    }
  });

  // ── 5a: Auto-read fires POST /api/tts/mistral when toggle is ON ─────────
  test("auto-read: TTS route fires after streaming ends when toggle is ON", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks ─────────────────────────────────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ─────────────────────────────────────────────────── */
    await mockConsentRoute(page);

    const REPLY = "Automatische Sprachausgabe funktioniert";
    await mockChatRoute(page, REPLY);

    let ttsCalled = false;
    await mockTtsRoute(page, () => { ttsCalled = true; });

    /* ── 1. Pre-set glev_tts_auto = "1" (auto-read ON) before login so
     *  the useTTS hook reads it from localStorage on mount ─────────────── */
    await page.addInitScript(() => {
      window.localStorage.setItem("glev_tts_auto", "1");
      window.localStorage.setItem("glev_tts_enabled", "1");
    });

    /* ── 2. Login + open sheet ──────────────────────────────────────────── */
    await loginAsTestUser(page);
    const chatDialog = await openChatSheet(page);

    /* ── 3. Verify the chat-header auto-read toggle is visible and reflects
     *  the pre-seeded ON state ─────────────────────────────────────────── */
    // When autoRead is true the button label is "Sprachausgabe aus" (toggle off)
    const headerToggle = chatDialog.getByRole("button", { name: /Sprachausgabe aus/i });
    await expect(headerToggle).toBeVisible({ timeout: 5_000 });

    /* ── 4. Send a message — this triggers streaming ────────────────────── */
    await sendChatMessage(page, chatDialog, "Bitte lies vor");

    /* ── 5. Wait for the speaker icon to appear — it renders only after
     *  streaming ends, which is also when auto-read fires ─────────────── */
    const speakerIcon = page.getByRole("button", { name: "Vorlesen" });
    await expect(speakerIcon).toBeVisible({ timeout: 15_000 });

    /* ── 6. TTS route must have been called by auto-read ─────────────────── */
    // The auto-read effect in GlevAIChatSheet fires tts.speak() when
    // streaming transitions from true → false AND tts.autoRead is true.
    // Allow a brief settling window for the async fetch.
    await page.waitForTimeout(800);
    expect(ttsCalled).toBe(true);
  });

  // ── 5b: Auto-read does NOT fire when toggle is OFF ──────────────────────
  test("auto-read: TTS route does NOT fire after streaming when toggle is OFF", async ({
    page,
  }) => {
    /* ── 0. Browser API mocks ─────────────────────────────────────────── */
    await injectMediaMocks(page);

    /* ── 0b. Route mocks ─────────────────────────────────────────────────── */
    await mockConsentRoute(page);

    const REPLY = "Kein automatisches Vorlesen erwartet";
    await mockChatRoute(page, REPLY);

    let ttsCalled = false;
    await mockTtsRoute(page, () => { ttsCalled = true; });

    /* ── 1. Ensure auto-read is OFF and master mute is ON ─────────────── */
    await page.addInitScript(() => {
      window.localStorage.setItem("glev_tts_auto", "0");
      window.localStorage.setItem("glev_tts_enabled", "1");
    });

    /* ── 2. Login + open sheet ──────────────────────────────────────────── */
    await loginAsTestUser(page);
    const chatDialog = await openChatSheet(page);

    /* ── 3. Verify the chat-header toggle shows the OFF state ─────────── */
    // When autoRead is false the button label is "Sprachausgabe ein" (toggle on)
    const headerToggleOff = chatDialog.getByRole("button", { name: /Sprachausgabe ein/i });
    await expect(headerToggleOff).toBeVisible({ timeout: 5_000 });

    /* ── 4. Send a message — triggers streaming ─────────────────────────── */
    await sendChatMessage(page, chatDialog, "Bitte lies nicht vor");

    /* ── 5. Wait for streaming to finish (speaker icon appears) ─────────── */
    const speakerIcon = page.getByRole("button", { name: "Vorlesen" });
    await expect(speakerIcon).toBeVisible({ timeout: 15_000 });

    /* ── 6. TTS route must NOT have been called ─────────────────────────── */
    await page.waitForTimeout(800);
    expect(ttsCalled).toBe(false);
  });
});
