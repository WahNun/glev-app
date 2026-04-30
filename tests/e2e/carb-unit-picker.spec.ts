// End-to-end coverage for the Settings → Carb unit picker.
//
// Why this exists:
//   Task #60 added unit/integration coverage for the EXPORT side of the
//   BE/KE feature (CSV header + values + PDF cover meta). But the
//   user-facing piece — the BE/KE/g picker in /settings — is still
//   uncovered. A regression in the picker (wrong default, broken
//   persistence, no live re-render of carb-displaying UI elsewhere)
//   would silently ship before the export tests ever fire, because
//   those tests assume the right unit reaches them via call-site
//   plumbing.
//
// What this asserts (and why each piece matters):
//   1. The default state on a fresh user is "g" — both the on-disk
//      value (profiles.carb_unit DEFAULT 'g' migration) and the
//      visible row subtitle ("g KH") agree before anything is clicked.
//   2. Clicking BE in the picker:
//        a. Flips the radio's aria-checked attribute live (no reload).
//        b. Persists to Supabase profiles.carb_unit (verified via the
//           service-role admin client — same one global-setup uses to
//           provision the test user).
//        c. Re-renders the SettingsRow subtitle to "BE" — that's a
//           different React component than the picker, so this proves
//           the broadcast/subscription wiring in `useCarbUnit` works
//           across hook instances.
//        d. Re-renders the carb cell of a seeded meal on /entries —
//           "60 g KH" → "5 BE" (60 grams ÷ 12 g/BE). That's the real
//           downstream check the task asks for: a carb-displaying UI
//           on a different page, not /settings, that swaps unit live.
//   3. Switching back to g restores the original state in DB + UI, so
//      subsequent runs of this spec start from a clean baseline.
//
// We deliberately drive the picker through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → settings page → carb-unit picker → hook
// → Supabase row.

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_FIXTURE_PATH } from "../global-setup";

interface TestUser { email: string; password: string; userId: string; }

function loadTestUser(): TestUser {
  const raw = fs.readFileSync(TEST_USER_FIXTURE_PATH, "utf8");
  return JSON.parse(raw) as TestUser;
}

/**
 * Same admin client shape `tests/support/testUser.ts` uses. We can't
 * import the helper itself (it doesn't expose the client), but the
 * env vars are already required for the suite to run, so re-creating
 * the client here is a one-liner with no extra setup risk.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "carb-unit-picker spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// IMPORTANT: the `profiles` table keys rows by `user_id` (FK to
// auth.users.id), NOT by `id` — the table simply has no `id` column.
// The original carb-unit hook had a typo here (`.eq("id", uid)`) which
// silently dropped every persistence write because Postgres rejected
// the column lookup; this spec catches exactly that class of regression.
async function readPersistedCarbUnit(userId: string): Promise<string | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("carb_unit")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles.carb_unit read failed: ${error.message}`);
  return (data?.carb_unit ?? null) as string | null;
}

/**
 * Reset the persisted unit back to the migration default. We do this in
 * beforeEach so each test starts from the same baseline regardless of
 * how a previous run / spec left the row.
 */
async function resetCarbUnit(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ carb_unit: "g" })
    .eq("user_id", userId);
  if (error) throw new Error(`profiles.carb_unit reset failed: ${error.message}`);
}

/**
 * Seed a single meal with a known carb load so the /entries page has
 * something to render the unit-aware carb cell against. 60g divides
 * cleanly by both 12 g/BE (→5 BE) and 10 g/KE (→6 KE), which keeps
 * the rendered text (no decimals) trivial to assert.
 *
 * Returns the new meal id so the test can clean it up afterwards.
 * Inserts via the service-role admin client to bypass RLS — exactly
 * the same channel global-setup already uses to provision the user,
 * so no new env-var coupling.
 */
async function seedMeal(userId: string, carbsGrams: number): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: "carb-unit-picker e2e fixture",
      carbs_grams: carbsGrams,
    })
    .select("id")
    .single();
  if (error) throw new Error(`meals seed failed: ${error.message}`);
  return data!.id as string;
}

async function deleteMeal(mealId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("meals").delete().eq("id", mealId);
  if (error) throw new Error(`meals cleanup failed: ${error.message}`);
}

// Locale-agnostic regexes for the labels we drive. The default app
// locale is "de" (see `lib/locale.ts`), but Playwright's Chromium
// reports an English Accept-Language header by default, so the active
// locale at runtime can flip either way depending on the environment.
// Matching both keeps the spec stable across machines.
//
// Note: the /settings page is a flat list of SettingsSection / SettingsRow
// components — no internal tablist — so unlike the older theme-picker
// pattern there's no settings-tab to click first. The carb-unit row is
// always in the DOM after navigation.
//
// SettingsRow ariaLabel = "Open <label>" / "<label> öffnen".
const CARB_UNIT_ROW_ARIA = /(Open Carb unit|Carb unit öffnen|Open Kohlenhydrate-Einheit|Kohlenhydrate-Einheit öffnen)/i;
// Radiogroup is labelled by the localized "Carb unit" / "Kohlenhydrate-Einheit".
const CARB_UNIT_RADIOGROUP = /^(Carb unit|Kohlenhydrate-Einheit)$/i;
// Radio labels: g="g carbs"/"g KH", BE="BE", KE="KE".
const G_RADIO_LABEL = /^(g carbs|g KH)$/i;
const BE_RADIO_LABEL = /^BE$/;
// Row subtitle uses CARB_UNITS[unit].label: "g KH" / "BE" / "KE".
// The button's full accessible text is "<label><subtitle>", e.g.
// "Carb unitg KH" or "Kohlenhydrate-EinheitBE", so we anchor on the
// END of the string to assert which subtitle is currently rendered.
const G_LABEL_TEXT = /g KH$/;
const BE_LABEL_TEXT = /BE$/;

// Display strings rendered by `formatCarbs(grams, unit)` on /entries
// (and other consumers of `carbUnit.display`). Today the labels in
// `CARB_UNITS` are hardcoded to "g KH" / "BE" / "KE" — but accepting
// the plausible English-localized variant ("60 g carbs") too keeps
// this spec stable if the labels are ever pushed through i18n the
// way the radio labels already are (messages/en.json: "carb_unit_g":
// "g carbs"). Anchored on word boundaries to avoid matching prefixes.
const ENTRIES_60G_TEXT = /^60 (?:g KH|g carbs)$/i;
const ENTRIES_5BE_TEXT = /^5 BE$/;

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

test.describe("Settings → Carb unit picker", () => {
  let testUser: TestUser;
  let seededMealId: string | null = null;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ page, context }) => {
    // Pristine baseline: clear cookies + reset the persisted row so the
    // initial-state assertion ("starts on g") doesn't depend on how a
    // previous spec left the user. Then seed one meal at 60g so /entries
    // has a deterministic carb cell to re-render.
    await context.clearCookies();
    await resetCarbUnit(testUser.userId);
    seededMealId = await seedMeal(testUser.userId, 60);
    await loginAsTestUser(page);
  });

  test.afterEach(async () => {
    // Always clean up the seeded meal — even if the test failed mid-run —
    // so re-runs and other specs see a meal-free user.
    if (seededMealId) {
      await deleteMeal(seededMealId);
      seededMealId = null;
    }
  });

  test("switches g ↔ BE live, persists to profiles.carb_unit, and re-renders the row subtitle and /entries", async ({ page }) => {
    // ---- INITIAL STATE ----------------------------------------------
    // Migration default + reset above guarantees this row reads "g".
    expect(await readPersistedCarbUnit(testUser.userId)).toBe("g");

    await page.goto("/settings");

    // The carb-unit row exposes its current value via the SettingsRow
    // subtitle. With unit=g this must be "g KH" (the human label from
    // CARB_UNITS["g"].label). If a future change accidentally flipped
    // the default to BE/KE, this assertion would catch it.
    const carbUnitRow = page.getByRole("button", { name: CARB_UNIT_ROW_ARIA });
    await expect(carbUnitRow).toBeVisible();
    await expect(carbUnitRow).toContainText(G_LABEL_TEXT);

    // ---- OPEN PICKER + SWITCH TO BE ---------------------------------
    await carbUnitRow.click();

    const radiogroup = page.getByRole("radiogroup", { name: CARB_UNIT_RADIOGROUP });
    await expect(radiogroup).toBeVisible();

    const gRadio = radiogroup.getByRole("radio", { name: G_RADIO_LABEL });
    const beRadio = radiogroup.getByRole("radio", { name: BE_RADIO_LABEL });

    // Sanity: g starts checked; BE does not.
    await expect(gRadio).toHaveAttribute("aria-checked", "true");
    await expect(beRadio).toHaveAttribute("aria-checked", "false");

    await beRadio.click();

    // Live UI flip: aria-checked must move from g → BE without any reload.
    await expect(beRadio).toHaveAttribute("aria-checked", "true");
    await expect(gRadio).toHaveAttribute("aria-checked", "false");

    // ---- DB PERSISTENCE ---------------------------------------------
    // setUnit() is optimistic: it broadcasts to subscribers immediately
    // and PATCHes profiles.carb_unit in the background. Poll the row
    // (via the service-role admin client, exactly the same channel the
    // export tests would care about) until the new value lands.
    await expect.poll(
      () => readPersistedCarbUnit(testUser.userId),
      { timeout: 10_000 },
    ).toBe("BE");

    // ---- ROW SUBTITLE RE-RENDERS ------------------------------------
    // Close the sheet and confirm the SettingsRow (a different React
    // component than the picker dialog) now shows "BE". The closeSheet
    // handler reverts macro/notif/setting drafts, but carb_unit lives
    // outside that snapshot — so the change must survive close.
    // BottomSheet listens for Escape (see components/BottomSheet.tsx);
    // use that rather than `getByRole("button", { name: "Close" })` —
    // there are two such buttons in the open sheet (the header X with
    // aria-label="Close" and the footer "Close" button), and either
    // would work but Escape is unambiguous and locale-independent.
    await page.keyboard.press("Escape");
    await expect(carbUnitRow).toContainText(BE_LABEL_TEXT);

    // ---- DOWNSTREAM PAGE RE-RENDERS (the "elsewhere" check) --------
    // Navigate to /entries — a different page that renders the seeded
    // meal's carb cell via `MealEntryCardCollapsed` (which calls
    // `useCarbUnit().display(meal.carbs_grams)`). With unit=BE the
    // 60g meal must read "5 BE". This is the strongest proof that the
    // chosen unit reaches consumers OUTSIDE /settings via the module
    // cache + subscriber broadcast in useCarbUnit.
    await page.goto("/entries");
    await expect(page.getByText(ENTRIES_5BE_TEXT).first())
      .toBeVisible({ timeout: 30_000 });

    // ---- SWITCH BACK TO g (clean baseline + reverse direction) -----
    await page.goto("/settings");
    await expect(carbUnitRow).toContainText(BE_LABEL_TEXT);
    await carbUnitRow.click();

    const radiogroup2 = page.getByRole("radiogroup", { name: CARB_UNIT_RADIOGROUP });
    const gRadio2 = radiogroup2.getByRole("radio", { name: G_RADIO_LABEL });
    const beRadio2 = radiogroup2.getByRole("radio", { name: BE_RADIO_LABEL });
    await expect(beRadio2).toHaveAttribute("aria-checked", "true");

    await gRadio2.click();
    await expect(gRadio2).toHaveAttribute("aria-checked", "true");
    await expect(beRadio2).toHaveAttribute("aria-checked", "false");

    await expect.poll(
      () => readPersistedCarbUnit(testUser.userId),
      { timeout: 10_000 },
    ).toBe("g");

    await page.keyboard.press("Escape");
    await expect(carbUnitRow).toContainText(G_LABEL_TEXT);

    // And the /entries carb cell swaps back to the gram representation.
    await page.goto("/entries");
    await expect(page.getByText(ENTRIES_60G_TEXT).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
