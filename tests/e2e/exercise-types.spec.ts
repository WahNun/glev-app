// End-to-end coverage for the widened exercise-type taxonomy
// (Task #203). Guards against the production regression where saving
// any value beyond the original `('hypertrophy','cardio')` pair was
// rejected by the `exercise_logs_exercise_type_check` Postgres CHECK
// because the widening migration hadn't been applied to the live
// database.
//
// What this asserts:
//   1. The exercise log form renders all ten type chips (cardio,
//      strength, hiit, yoga, cycling, run, football, tennis,
//      volleyball, basketball) — the chip text is locale-aware so the
//      assertions accept either the English OR the German label.
//   2. For EACH of the ten types, picking it + entering a duration +
//      clicking "Log Exercise" succeeds (no error banner) and writes
//      a row to `exercise_logs` with the chosen `exercise_type`. This
//      is the regression check for the CHECK-constraint bug.
//   3. After flipping the active locale to German via the
//      `NEXT_LOCALE` cookie, the chip for `football` renders as
//      "Fußball" — proves the form labels follow `messages/de.json`
//      instead of being hardcoded English. The same widening that
//      added `football` to the union added the German `Fußball`
//      translation, and the bug we hit during code review was that
//      the chips silently rendered English even with the German UI
//      selected.
//
// We hit /engine?tab=exercise so the ExerciseForm is the only thing on
// the page (mobile sub-tab) — keeps locators simple and avoids racing
// the InsulinForm that lives in the desktop /engine?tab=log layout.

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
    throw new Error("exercise-types spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function deleteExerciseLogs(userId: string) {
  const admin = getAdminClient();
  const { error } = await admin.from("exercise_logs").delete().eq("user_id", userId);
  if (error) throw new Error(`exercise_logs cleanup failed: ${error.message}`);
}

async function fetchExerciseTypes(userId: string): Promise<string[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("exercise_logs")
    .select("exercise_type")
    .eq("user_id", userId);
  if (error) throw new Error(`exercise_logs read failed: ${error.message}`);
  return (data ?? []).map(r => r.exercise_type as string);
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

// Type → both locale labels. The form chips render the active
// locale's value via `exerciseTypeLabelI18n(useTranslations("insights"),
// type)` which reads `exercise_type_*` from messages/{de,en}.json. The
// "match either" regex makes the persistence test locale-agnostic;
// the dedicated German-locale test below verifies the German label
// specifically.
const TYPE_LABELS: { type: string; en: string; de: string }[] = [
  { type: "cardio",     en: "Cardio",            de: "Cardio" },
  { type: "strength",   en: "Strength training", de: "Krafttraining" },
  { type: "hiit",       en: "HIIT",              de: "HIIT" },
  { type: "yoga",       en: "Yoga",              de: "Yoga" },
  { type: "cycling",    en: "Cycling",           de: "Radfahren" },
  { type: "run",        en: "Running",           de: "Laufen" },
  { type: "football",   en: "Football",          de: "Fußball" },
  { type: "tennis",     en: "Tennis",            de: "Tennis" },
  { type: "volleyball", en: "Volleyball",        de: "Volleyball" },
  { type: "basketball", en: "Basketball",        de: "Basketball" },
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chipPattern(t: { en: string; de: string }) {
  // Either locale, exact-match (no surrounding text) so the strength
  // chip doesn't match the "Strength training" copy elsewhere.
  return new RegExp(`^(${escapeRe(t.en)}|${escapeRe(t.de)})$`);
}

// Submit button — "Log Exercise" / "Übung loggen".
const SUBMIT_LABEL = /^(Log Exercise|Übung loggen)$/;
// Success banner uses the `exercise_logged_no_cgm` / `exercise_logged_with_cgm`
// templates, both of which start with "Logged" / "Geloggt".
const SUCCESS_PREFIX = /^(Logged|Geloggt)/;
// Error banner template: "Speichern fehlgeschlagen — …" / "Save failed — …".
const ERROR_PREFIX = /Speichern fehlgeschlagen|Save failed/i;

test.describe("Engine → Exercise form taxonomy", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    await deleteExerciseLogs(testUser.userId);
  });

  test.afterAll(async () => {
    await deleteExerciseLogs(testUser.userId);
  });

  test("saves a log for each of the ten exercise types without a check-constraint error", async ({ page }) => {
    await loginAsTestUser(page);
    // The "exercise" sub-tab renders only the ExerciseForm — no
    // adjacent InsulinForm to fight for the "Type" / "Duration" labels.
    await page.goto("/engine?tab=exercise");

    // The type picker is now a custom dropdown (disclosure button +
    // ARIA listbox). The trigger sits above the duration field; the
    // option list is mounted only while open. Open it once to assert
    // every label is present, then close it again so we start the
    // loop from a known state.
    const dropdownTrigger = page.locator('button[aria-haspopup="listbox"]').first();
    await expect(dropdownTrigger).toBeVisible();
    await dropdownTrigger.click();
    for (const label of TYPE_LABELS) {
      await expect(
        page.getByRole("option", { name: chipPattern(label) }),
      ).toBeVisible();
    }
    // Press Escape to close the listbox before driving the form so the
    // submit button isn't covered by the absolute-positioned options.
    await page.keyboard.press("Escape");

    const durationInput = page.locator('input[type="number"]').first();
    await expect(durationInput).toBeVisible();

    for (const label of TYPE_LABELS) {
      // Open the dropdown and pick the option. The listbox auto-closes
      // on selection so each iteration re-opens it explicitly.
      await dropdownTrigger.click();
      await page.getByRole("option", { name: chipPattern(label) }).click();
      // Re-enter duration each iteration — handleSubmit clears the
      // field on success.
      await durationInput.fill("30");
      // Submit and wait for the banner.
      await page.getByRole("button", { name: SUBMIT_LABEL }).click();

      const success = page.locator("div").filter({ hasText: SUCCESS_PREFIX }).first();
      await expect(success).toBeVisible({ timeout: 15_000 });

      // Defensive: assert no error banner crept in alongside.
      const errorBanner = page.locator("div").filter({ hasText: ERROR_PREFIX });
      await expect(errorBanner).toHaveCount(0);
    }

    // ---- DB-level check: exactly the ten types we just submitted. ----
    const stored = await fetchExerciseTypes(testUser.userId);
    const expected = TYPE_LABELS.map(t => t.type).sort();
    expect(stored.sort()).toEqual(expected);
  });

  test("renders German labels (incl. Fußball) when the locale cookie is 'de'", async ({ page, context }) => {
    await loginAsTestUser(page);
    // Force German locale the same way the language picker does:
    // by writing the NEXT_LOCALE cookie that i18n/request.ts reads on
    // every server render. Using a path-scoped + matching baseURL host
    // mirrors writeLocaleCookie() in lib/locale.ts.
    const url = new URL(page.url());
    await context.addCookies([{
      name:    "NEXT_LOCALE",
      value:   "de",
      domain:  url.hostname,
      path:    "/",
      sameSite: "Lax",
    }]);

    await page.goto("/engine?tab=exercise");

    // Open the type dropdown so the option list is mounted; the
    // assertions below target ARIA listbox options now that the picker
    // is a disclosure menu instead of a button grid.
    await page.locator('button[aria-haspopup="listbox"]').first().click();

    // Football is the headline acceptance criterion in the task spec —
    // German users must see "Fußball", not "Football". A regression
    // back to hardcoded English would fail here even if the persistence
    // test above still passed.
    await expect(
      page.getByRole("option", { name: /^Fußball$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /^Krafttraining$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /^Laufen$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /^Radfahren$/ }),
    ).toBeVisible();

    // And the English chip must NOT be present — catches a future bug
    // where both locales' labels somehow ended up rendered side by side.
    await expect(
      page.getByRole("option", { name: /^Football$/ }),
    ).toHaveCount(0);
  });
});
