// End-to-end coverage that the bolus brand label renders in the Entries list
// collapsed row (Task #603).
//
// What & why:
//   Task #581 added the "5u NovoRapid" display format to the DOSE column of
//   collapsed bolus rows in the Entries list. The format is built in
//   `BolusRowCard` as:
//
//     secondaryValue = log.insulin_name
//       ? `${log.units}u ${log.insulin_name}`
//       : `${log.units}u`
//
//   Without an automated test a future refactor of `NonMealRow` or
//   `BolusRowCard` could silently drop the brand name and only show the
//   bare unit count — a regression that is not caught by any existing spec.
//
// What this asserts:
//   1. A seeded bolus row with `units=5, insulin_name="NovoRapid"` renders
//      the combined string "5u NovoRapid" inside the collapsed DOSE column
//      of the Entries list.
//   2. The combined string is present in the `.glev-mec` collapsed-row grid
//      — the same grid class the snap-slider-edit-dialogs spec already relies
//      on.  This scopes the assertion to the collapsed header strip only, so
//      it does NOT accidentally match the expanded detail view (which shows
//      dose and brand as two separate `<Detail>` cells).
//   3. When `insulin_name` is present, the combined format is used.  A bare
//      unit string (e.g. "5u" without brand) would indicate the brand branch
//      was not taken.
//
// Selector rationale for the collapsed secondary value:
//   The `.glev-mec` div is the 4-column grid of the collapsed row header.
//   Its Col 4 renders `secondaryValue` as plain text with no dedicated CSS
//   class.  We assert `toContainText` on the `.glev-mec` div scoped to the
//   specific card id (`#entry-insulin-<id>`), which is unique per row and
//   set by NonMealRow.  This catches:
//     - The brand name being dropped entirely → "5u" would not match "5u NovoRapid"
//     - The unit and brand being swapped → "NovoRapid 5u" would not match
//     - The format separator changing → "5 u NovoRapid" would not match
//
// Why the expanded view cannot satisfy this assertion:
//   In the expanded view the dose is shown as "5 u" (with a space before "u")
//   in a `<Detail>` cell and the brand "NovoRapid" in a separate adjacent
//   cell — the combined "5u NovoRapid" token is never rendered there.  Only
//   the collapsed secondary column produces this exact string.
//
// Test data lifecycle:
//   beforeAll  — inserts one `insulin_logs` row via the service-role client.
//   afterAll   — deletes that row by id.
//   The test never mutates the row, so multiple re-runs are safe.

import { expect, test, type Page } from "@playwright/test";
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
      "bolus-brand-label spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Seed values — deliberately unusual numbers / names to avoid collisions
// with any other rows in the test user's entries list.
const BOLUS_UNITS = 5;
const BOLUS_BRAND = "NovoRapid";
const EXPECTED_DOSE_LABEL = `${BOLUS_UNITS}u ${BOLUS_BRAND}`; // "5u NovoRapid"

let seededLogId: string | null = null;

async function seedBolusLog(userId: string): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("insulin_logs")
    .insert({
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: BOLUS_BRAND,
      units: BOLUS_UNITS,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insulin_logs seed failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

async function deleteBolusLog(id: string) {
  try {
    const admin = getAdminClient();
    await admin.from("insulin_logs").delete().eq("id", id);
  } catch {
    /* non-fatal — test data cleanup */
  }
}

async function loginAsTestUser(page: Page) {
  const { email, password } = loadTestUser();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 90_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

test.describe("Entries → bolus collapsed row shows brand label in DOSE column (Task #603)", () => {
  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = loadTestUser();
    seededLogId = await seedBolusLog(testUser.userId);
  });

  test.afterAll(async () => {
    if (seededLogId) await deleteBolusLog(seededLogId);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("collapsed bolus row DOSE column contains unit count and brand name", async ({ page }) => {
    await loginAsTestUser(page);

    await page.goto("/entries", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/entries/, { timeout: 30_000 });

    // Clear persisted filter state so the date range never clips our fixture.
    await page.evaluate(() => sessionStorage.removeItem("glev:entries-filters"));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL(/\/entries/, { timeout: 30_000 });

    // NonMealRow wraps the entire card (collapsed + expanded) in a div with
    // id="entry-insulin-<logId>".  Waiting for it confirms the row has loaded.
    const cardId = `#entry-insulin-${seededLogId}`;
    await expect(page.locator(cardId)).toBeAttached({ timeout: 30_000 });

    // The collapsed grid div carries class "glev-mec".  It is only rendered
    // when the row is NOT expanded, so finding it here also confirms the row
    // starts in its collapsed state (the normal default).
    const collapsedGrid = page.locator(cardId).locator(".glev-mec");
    await expect(collapsedGrid).toBeVisible({ timeout: 10_000 });

    // Core assertion: the DOSE column (Col 4, secondaryValue) must render the
    // combined "5u NovoRapid" string.  `toContainText` is intentional — we
    // want to catch the string being present anywhere in the collapsed grid,
    // not just an exact-match on the entire cell, in case the grid cell div
    // also renders the optional ICR subtitle in the same container.
    await expect(
      collapsedGrid,
      `collapsed DOSE cell should show "${EXPECTED_DOSE_LABEL}" (unit count + brand name)`,
    ).toContainText(EXPECTED_DOSE_LABEL);

    // Negative check: the bare unit string alone must not be the only thing
    // rendered.  If the brand name was dropped, the cell would read "5u"
    // (without brand) — catch that by verifying the full combined form is
    // present, which the assertion above already does.  As an extra guard,
    // confirm the brand name specifically appears within the collapsed grid.
    await expect(
      collapsedGrid,
      `collapsed grid must include the brand name "${BOLUS_BRAND}"`,
    ).toContainText(BOLUS_BRAND);
  });
});
