// End-to-end coverage for the desktop EngineChatPanel sidebar layout
// (task #22 — "Engine-Wizard zeigt Chat-Panel auch auf Desktop als
// Sidebar").
//
// Why this exists:
//   /engine ships a 3-step wizard (Step 1 = voice/chat input, Step 2 =
//   macros, Step 3 = recommendation). Before this change the
//   EngineChatPanel was mounted INSIDE Step 1's body — meaning desktop
//   users lost the chat the moment they advanced to Step 2 or 3. The
//   task split the layout in two: a sticky right sidebar on desktop
//   (>768px) hosts the chat for the whole wizard, while mobile
//   (<=768px) keeps the legacy stacked layout (chat inside Step 1).
//
// What this asserts:
//   1. Desktop viewport (1280x800):
//        - The EngineChatPanel renders as a sticky sidebar to the
//          RIGHT of the wizard column (chat header's bounding box
//          left edge is greater than the Sprechen pill's right edge
//          AND it shares roughly the same vertical band as Step 1's
//          content — proving side-by-side layout, not stacked).
//        - The chat panel mounts EXACTLY ONCE so we don't accidentally
//          double-render it (which would split the chat session
//          between the in-Step-1 mount and the sidebar mount).
//   2. Mobile viewport (390x844):
//        - The wrapper degrades to a single-column layout, so the
//          chat panel falls back to its in-Step-1 mount and appears
//          BELOW the Sprechen pill, not to the right of it.
//        - Chat panel mounts EXACTLY ONCE on mobile too.
//
// We deliberately verify the LAYOUT VIA BOUNDING BOXES (rendered
// position) rather than computed grid-template-columns. A regression
// that re-introduced the chat inside Step 1 on desktop would still
// pass any pure styling assertion on the wrapper — the bounding-box
// check is what actually proves the chat ended up in the sidebar.
//
// We deliberately drive the page through the real login flow so this
// catches regressions anywhere between middleware → /engine page
// render → isMobile breakpoint → wrapper styling.

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

// EngineChatPanel header copy. The "AI FOOD PARSER" caps label is
// the canonical first identifier of the panel header in BOTH locales
// (EN: "AI FOOD PARSER", DE: "AI FOOD PARSER" — kept English for
// brand consistency, see messages/de.json:129). Targeting it lets a
// single locator find the panel regardless of the active language.
const CHAT_TITLE = /AI FOOD PARSER/i;
// Voice button accessible name — the button uses an aria-label
// (`engine.voice_aria_start`) which takes precedence over its visible
// text. Cover both locales so the test runs regardless of the active
// language.
const SPEAK_BTN = /(Start (recording|voice input)|Sprach-Eingabe starten|Aufnahme starten)/i;

test.describe("Engine wizard chat-panel layout", () => {
  test("desktop (>768px) renders the chat panel as a sticky right sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsTestUser(page);

    await page.goto("/engine");
    // Wait for the Sprechen voice button — that's the canonical first
    // element of Step 1, so once it's visible the wizard column has
    // mounted and isMobile has settled to false.
    const sprechenBtn = page.getByRole("button", { name: SPEAK_BTN }).first();
    await expect(sprechenBtn).toBeVisible({ timeout: 30_000 });

    // The chat panel is identified by its header title. On desktop we
    // expect EXACTLY ONE mount (in the sticky sidebar) — the in-Step-1
    // mount must be skipped to avoid double-rendering the chat session.
    const chatTitles = page.getByText(CHAT_TITLE);
    const titleCount = await chatTitles.count();
    expect(titleCount, "chat panel should mount exactly once on desktop").toBe(1);

    // Wait for paint — on first-compile dev mode the chat header can
    // appear a tick after Step 1 mounts, which would otherwise null
    // out the bounding box read below.
    await expect(chatTitles.first()).toBeVisible();

    const chatBox = await chatTitles.first().boundingBox();
    const sprechenBox = await sprechenBtn.boundingBox();
    expect(chatBox, "chat header bounding box").not.toBeNull();
    expect(sprechenBox, "sprechen pill bounding box").not.toBeNull();
    if (!chatBox || !sprechenBox) return;

    // Sidebar must sit to the right of the wizard's primary CTA.
    expect(chatBox.x).toBeGreaterThan(sprechenBox.x + sprechenBox.width);

    // Sidebar should share roughly the same vertical band as the
    // Sprechen pill (i.e. it's in a side-by-side layout, not stacked
    // below). We allow generous tolerance because the sidebar's
    // sticky offset is 16px from the top of the main scroller while
    // the Sprechen pill sits below the step indicator.
    expect(chatBox.y).toBeLessThan(sprechenBox.y + sprechenBox.height + 100);
  });

  test("mobile (<=768px) keeps the chat panel stacked inside Step 1", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsTestUser(page);

    await page.goto("/engine");
    const sprechenBtn = page.getByRole("button", { name: SPEAK_BTN }).first();
    await expect(sprechenBtn).toBeVisible({ timeout: 30_000 });

    const chatTitles = page.getByText(CHAT_TITLE);
    expect(await chatTitles.count(), "chat panel should mount exactly once on mobile").toBe(1);

    // Wait for the panel to actually be visible — on slow / dev-mode
    // first compiles the title can paint a tick after Step 1 mounts,
    // which would otherwise null out the bounding box read below.
    await expect(chatTitles.first()).toBeVisible();
    await chatTitles.first().scrollIntoViewIfNeeded();

    const chatBox = await chatTitles.first().boundingBox();
    const sprechenBox = await sprechenBtn.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(sprechenBox).not.toBeNull();
    if (!chatBox || !sprechenBox) return;

    // Chat must appear BELOW the Sprechen pill (stacked, not
    // side-by-side). We require a strictly greater Y so a regression
    // that pushed the chat to the right would fail this test.
    expect(chatBox.y).toBeGreaterThan(sprechenBox.y + sprechenBox.height - 1);

    // Horizontally the chat header should overlap the Sprechen pill's
    // x-band — confirming the single-column layout, not a sidebar.
    expect(chatBox.x).toBeLessThan(sprechenBox.x + sprechenBox.width);
  });
});
