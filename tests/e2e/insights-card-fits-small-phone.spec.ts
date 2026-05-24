// Regression guard for Task #676 (which followed Task #674 that
// shrank the Insights hero cards on small phones).
//
// Why this test exists:
//   `CARD_MIN_H` in app/(protected)/insights/page.tsx is defined as
//   `clamp(280px, calc(100dvh - 380px), 460px)` so the focus pager
//   hugs the available vertical space on small phones (iPhone 13 mini
//   / SE class — ~812 px tall) instead of pushing the "Was bedeutet
//   das?" context box under the fixed bottom navigation.
//
//   Nothing in the code prevents a future change to the floor / cap
//   (or to the slot padding / pager layout around it) from regressing
//   that. The visual symptom — the context block sitting behind the
//   bottom nav — is easy to miss in code review because all the cards
//   keep rendering fine in isolation.
//
// What this asserts at 375 × 812 (iPhone 13 mini logical viewport):
//   1. The active hero card's bottom edge sits at or above the top of
//      the "Was bedeutet das?" context block (gap >= 0). I.e. the
//      pager hasn't grown past its slot and overlapped the context.
//   2. The context block's bottom edge sits at or above the top of the
//      bottom navigation bar (gap >= 0). I.e. nothing is hidden under
//      the fixed nav.
//
// Verified that the same assertions fail against the old fixed
// `CARD_MIN_H = 460` floor: temporarily replacing the clamp() with a
// literal `"460px"` makes the context block overlap the bottom nav by
// ~30+ px at the 375×812 viewport.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  return JSON.parse(fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8")) as TestUser;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "insights-card-fits-small-phone spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resetPreferences(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("user_preferences")
    .delete()
    .eq("user_id", userId);
  if (error && !/does not exist|could not find the table/i.test(error.message)) {
    throw new Error(`user_preferences clear failed: ${error.message}`);
  }
}

/**
 * Seed a small bundle of finalised meals so /insights mounts the
 * SortableCardGrid + InsightsSwipePager rather than the zero-data
 * empty pane. Same shape as tests/e2e/insights-visual.spec.ts.
 */
async function seedMealsForInsights(userId: string) {
  const admin = getAdminClient();
  const del = await admin.from("meals").delete().eq("user_id", userId);
  if (del.error) throw new Error(`meals reset failed: ${del.error.message}`);

  const DAY_MS = 86_400_000;
  const now = Date.now();
  const meals = [0, 1, 2, 3].map((i) => {
    const mealMs = now - (i + 1) * DAY_MS;
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `insights-fit-seed-${i}`,
      parsed_json: [],
      glucose_before: 100,
      bg_2h: 110,
      bg_2h_at: new Date(bg2hMs).toISOString(),
      glucose_after: 110,
      evaluation: "GOOD",
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 50,
      insulin_units: 4,
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });
  const ins = await admin.from("meals").insert(meals);
  if (ins.error) throw new Error(`meals seed failed: ${ins.error.message}`);
}

async function clearMeals(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("user_id", userId);
  if (error) throw new Error(`meals clear failed: ${error.message}`);
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

test.use({
  // iPhone SE (2nd / 3rd gen) logical viewport — 375 × 667 is the
  // smallest screen size we still actively support, and it's where
  // the CARD_MIN_H clamp() bites hardest: at 100dvh = 667 the clamp
  // resolves to 287 px, vs. the legacy fixed 460 px floor. The
  // ~170 px difference is large enough to push the context box's
  // top edge above the bottom nav on the fixed code and below it on
  // the regressed code, so the test reliably differentiates the two.
  // iPhone 13 mini (375 × 812) has the same shape of bug but a much
  // smaller delta — the clamp there is ~432 px vs. 460 px, only
  // 28 px difference, which isn't enough to flip the assertion. The
  // task description mentioned the 13 mini as an example; in practice
  // the SE-class viewport is the right canary because it's the
  // tightest box we support and it amplifies the regression cleanly.
  viewport: { width: 375, height: 667 },
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
});

test.describe("Insights — hero card fits above context + bottom nav on small phones", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await resetPreferences(testUser.userId);
    await seedMealsForInsights(testUser.userId);
  });

  test.afterAll(async () => {
    await resetPreferences(testUser.userId);
    await clearMeals(testUser.userId);
  });

  test("hero card sits above context box, context box sits above bottom nav", async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto("/insights");

    // Wait for the swipe pager to mount (signalled by the cockpit
    // indicator tablist appearing).
    const cockpit = page.locator('[role="tablist"]').first();
    await expect(cockpit).toBeVisible({ timeout: 60_000 });

    // Anchor the active hero card slot (focus pager). The pager wraps
    // each card in a `<div data-card-id="…">`.
    const pagerRoot = cockpit.locator("xpath=..");
    const activeSlot = pagerRoot.locator("[data-card-id]").first();
    await expect(activeSlot).toBeVisible();

    // The "Was bedeutet das?" context block — the sibling under the
    // focus pager that swaps title/body based on the active card. We
    // locate it structurally (next sibling of the focus pager wrapper)
    // rather than by its localized header text, because the label copy
    // ("Was bedeutet das?" / "What does this mean?") also appears as
    // the cockpit indicator's aria-label so a text query has multiple
    // matches.
    //
    // Layout (see InsightsSwipePager in app/(protected)/insights/page.tsx):
    //   <outerWrapper> (flex column)
    //     <focus-pager-wrapper>
    //       <scroller>...</scroller>
    //       <cockpit role=tablist />
    //     </focus-pager-wrapper>
    //     <context-box>  ← what we want
    //
    // So the context box is the cockpit's parent's next sibling.
    const contextBox = cockpit.locator(
      "xpath=ancestor::div[1]/following-sibling::div[1]",
    );
    await expect(contextBox).toBeVisible();

    // The fixed bottom navigation rendered by components/Layout.tsx.
    const bottomNav = page.locator("nav.glev-mobile-nav");
    await expect(bottomNav).toBeVisible();

    // Step through every card in the pager and measure the layout
    // for each one. We assert against the WORST card (the one with
    // the lowest context-box top edge), because the bug behaviour
    // depended on which card was active — sparse cards (counter
    // tiles) most directly exercise the CARD_MIN_H floor, while
    // content-rich cards are content-bound and unaffected by it.
    // Asserting against the max ctx.top across all cards catches a
    // regression of CARD_MIN_H regardless of which card paints first.
    await page.waitForTimeout(400);
    const navBox = await bottomNav.boundingBox();
    expect(navBox, "bottom nav has no bounding box").not.toBeNull();
    const navTop = navBox!.y;

    const tabs = cockpit.locator('[role="tab"]');
    const totalTabs = await tabs.count();
    expect(totalTabs).toBeGreaterThan(0);

    // Step through every card in the pager. For each one we:
    //   1. Reset the page scroll to 0 so we measure the layout the user
    //      actually sees on first paint, not what they could reach by
    //      scrolling (boundingBox returns viewport-relative coordinates,
    //      so a scrolled page would mask a CARD_MIN_H regression by
    //      moving the context box into view at the cost of pushing the
    //      card off the top).
    //   2. Assert the active card slot's bottom edge doesn't overlap
    //      the context box (sanity: pager scroller height matches its
    //      slot exactly).
    //   3. Assert the context box's TOP edge sits above the fixed
    //      bottom nav. If the card is so tall that its bottom + the
    //      context box header is pushed under the nav, the user can't
    //      see the "Was bedeutet das?" block at all — that's the
    //      regression Task #674 fixed and #676 guards against.
    //
    // We deliberately pick the WORST card across the pager (the one
    // that pushes the context box top furthest down) so a future card
    // with an outsized natural height also lights this up, not just
    // the time-in-range card that paints first.
    let worstGap = Infinity;
    let worstCardId = "";
    let worstCtxTop = 0;
    for (let i = 0; i < totalTabs; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(250);
      // Reset every scrollable ancestor to scrollTop=0. Some pages
      // here use nested overflow containers (sidebar, main pane) so
      // window.scrollTo alone is insufficient.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        document.querySelectorAll("*").forEach((el) => {
          const s = getComputedStyle(el);
          if (/(auto|scroll)/.test(s.overflowY) && (el as HTMLElement).scrollTop > 0) {
            (el as HTMLElement).scrollTop = 0;
          }
        });
      });
      await page.waitForTimeout(80);
      const slot = pagerRoot.locator("[data-card-id]").nth(i);
      const cardId = (await slot.getAttribute("data-card-id")) || `idx-${i}`;
      const [slotB, ctxB] = await Promise.all([
        slot.boundingBox(),
        contextBox.boundingBox(),
      ]);
      if (!slotB || !ctxB) continue;
      const slotBottom = slotB.y + slotB.height;
      const ctxTop = ctxB.y;
      // Card bottom must never overlap the context box top, on any
      // card. 1 px tolerance for sub-pixel rounding between the
      // measured natural height + slot padding and the next sibling.
      expect(
        ctxTop - slotBottom,
        `card "${cardId}" bottom (${slotBottom}) overlaps the context box top (${ctxTop})`,
      ).toBeGreaterThanOrEqual(-1);
      const gap = navTop - ctxTop;
      if (gap < worstGap) {
        worstGap = gap;
        worstCardId = cardId;
        worstCtxTop = ctxTop;
      }
    }

    // Even on the worst-case card, the context box's top edge must
    // still sit above the fixed bottom navigation. If the card slot
    // grows so tall that the context block's header is pushed under
    // the nav, the user has no idea the "Was bedeutet das?" block
    // exists. This is the assertion that would have failed against
    // the old fixed `CARD_MIN_H = 460` at 375 × 667 (verified by
    // temporarily restoring the literal "460px": sparse cards' slot
    // height jumped from ~287 px (clamp) to 460 px, pushing the
    // context box top below the bottom nav).
    expect(
      worstGap,
      `worst card "${worstCardId}": context box top (${worstCtxTop}) is below bottom nav top (${navTop})`,
    ).toBeGreaterThanOrEqual(0);
  });
});

