// End-to-end test for the cycle and symptom logging flow.
//
// ── What is tested ────────────────────────────────────────────────────────
//
// CycleForm (at /engine?tab=cycle):
//   1. The "Zyklus" tab opens and the save button is visible.
//   2. Saving a bleeding entry (today's date, medium flow) shows the
//      German success banner "Blutung am … gespeichert".
//   3. After saving, navigating to /entries shows the cycle entry in
//      the merged timeline (row labelled "Blutung").
//
// SymptomForm (at /engine?tab=symptoms):
//   4. Selecting "Kopfschmerzen" chip and clicking "Speichern" calls
//      the API and triggers an auto-redirect to /entries.
//   5. The symptom entry appears on the /entries page ("headache" is
//      visible in the rendered rows via its German label "Kopfschmerzen").
//
// Insights card:
//   6. After both saves, the /insights page renders the
//      "Zyklus & Symptome" (or "Symptome") card without crashing.
//
// ── Test lifecycle ─────────────────────────────────────────────────────────
//   beforeAll  — service-role client instantiated for afterAll cleanup.
//   beforeEach — clear cookies, pin NEXT_LOCALE=de, log in.
//   afterAll   — delete all menstrual_logs + symptom_logs rows inserted
//                during this run via the service-role client.
//
// ── Locale ────────────────────────────────────────────────────────────────
//   NEXT_LOCALE=de is pinned via cookie.  Strings used in assertions:
//     "Zyklus speichern"                → cycle form save button label
//     "Blutung am"                      → prefix of cycle success banner
//     "Blutung"                         → cycle entry label in /entries
//     "Kopfschmerzen"                   → headache chip + entry in /entries
//     "Speichern"                       → symptom form save button label
//     "Zyklus & Symptome" / "Symptome"  → Insights card title

import { expect, test, type Page, type BrowserContext } from "@playwright/test";
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
      "cycle-symptom-logging spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function pinGermanLocale(context: BrowserContext, baseURL: string) {
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: "de",
    url: baseURL,
    sameSite: "Lax",
  }]);
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

/** Today's date in YYYY-MM-DD local time — matches what the CycleForm's
 *  todayDate() helper produces. */
function localToday(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

// IDs of rows inserted during this run, collected from API responses and
// deleted in afterAll to keep the test user's data clean.
const insertedMenstrualIds: string[] = [];
const insertedSymptomIds: string[] = [];

test.use({ actionTimeout: 15_000 });

// ───────────────────────────────────────────────────────────────────────────
// CycleForm
// ───────────────────────────────────────────────────────────────────────────

test.describe("CycleForm — save a bleeding entry", () => {
  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = loadTestUser();
    void testUser;
  });

  test.afterAll(async () => {
    if (insertedMenstrualIds.length === 0) return;
    const admin = getAdminClient();
    await admin
      .from("menstrual_logs")
      .delete()
      .in("id", insertedMenstrualIds);
    insertedMenstrualIds.length = 0;
  });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page);
  });

  // ── Test 1: The cycle tab opens and the save button is visible ──────────
  test("'Zyklus speichern' button is visible on the cycle tab", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/engine?tab=cycle", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/engine/, { timeout: 30_000 });

    const saveBtn = page.getByRole("button", { name: "Zyklus speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 120_000 });
  });

  // ── Test 2: Saving a bleeding entry shows the success banner ────────────
  // The CycleForm starts in "bleeding" mode with today's date and
  // medium flow pre-selected, so clicking "Zyklus speichern" directly
  // triggers a successful save without any extra interaction.
  test("saving bleeding entry shows 'Blutung am … gespeichert' banner", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/engine?tab=cycle", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/engine/, { timeout: 30_000 });

    const saveBtn = page.getByRole("button", { name: "Zyklus speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 120_000 });

    // Intercept the API response to capture the inserted row ID.
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/menstrual") && resp.status() === 201,
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const resp = await responsePromise.catch(() => null);
    if (resp) {
      try {
        const body = await resp.json() as { log?: { id?: string } };
        if (body.log?.id) insertedMenstrualIds.push(body.log.id);
      } catch {
        // ID capture best-effort — correctness unaffected.
      }
    }

    // The success banner must contain the "Blutung am" prefix.
    // The exact date string is dynamic so we use a partial matcher.
    const banner = page.locator("div").filter({ hasText: /Blutung am/ }).first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 3: Cycle entry appears on the /entries page ───────────────────
  // After saving, navigate to /entries and confirm the merged timeline
  // shows a row labelled "Blutung" (the German cycle row heading).
  test("cycle entry is visible on /entries after saving", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/engine?tab=cycle", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/engine/, { timeout: 30_000 });

    const saveBtn = page.getByRole("button", { name: "Zyklus speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 120_000 });

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/menstrual") && resp.status() === 201,
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const resp = await responsePromise.catch(() => null);
    if (resp) {
      try {
        const body = await resp.json() as { log?: { id?: string } };
        if (body.log?.id) insertedMenstrualIds.push(body.log.id);
      } catch {}
    }

    // Navigate to /entries and look for a cycle entry row.
    await page.goto("/entries", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForURL(/\/entries/, { timeout: 30_000 });

    // The entries page renders a "Blutung" label inside the cycle row card.
    // We search broadly across the page since the card renders in a timeline.
    const today = localToday();
    // At minimum, confirm a "Blutung" text appears on the page (from the
    // cycle row's heading or the date badge). If the test user logged
    // multiple cycles, any one counts.
    const blutungText = page.locator("text=Blutung").first();
    await expect(blutungText).toBeVisible({ timeout: 30_000 });

    // Also confirm the date matches today (sanity check that it's the
    // entry we just saved, not a historical one).
    const todayFormatted = today; // YYYY-MM-DD, rendered somewhere in the row
    // The entries list renders dates — at least one should contain today.
    await expect(page.locator(`text=${todayFormatted}`).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SymptomForm
// ───────────────────────────────────────────────────────────────────────────

test.describe("SymptomForm — save a symptom entry", () => {
  test.afterAll(async () => {
    if (insertedSymptomIds.length === 0) return;
    const admin = getAdminClient();
    await admin
      .from("symptom_logs")
      .delete()
      .in("id", insertedSymptomIds);
    insertedSymptomIds.length = 0;
  });

  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page);
  });

  // ── Test 4: Saving a symptom redirects to /entries ─────────────────────
  // The SymptomForm auto-redirects to /entries after a successful save
  // (per the glev:symptom-updated custom event + router.push in the component).
  test("saving a symptom entry auto-redirects to /entries", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/engine?tab=symptoms", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/engine/, { timeout: 30_000 });

    const headacheChip = page.getByRole("button", { name: "Kopfschmerzen" });
    await expect(headacheChip).toBeVisible({ timeout: 120_000 });
    await headacheChip.click();

    // Severity radiogroup must appear — default is 3, so we can save immediately.
    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 });

    const saveBtn = page.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // Intercept the API response to capture the inserted row ID.
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/symptoms") && resp.status() === 201,
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const resp = await responsePromise.catch(() => null);
    if (resp) {
      try {
        const body = await resp.json() as { log?: { id?: string } };
        if (body.log?.id) insertedSymptomIds.push(body.log.id);
      } catch {}
    }

    // The component redirects to /entries after a successful save.
    await page.waitForURL(/\/entries/, { timeout: 30_000 });
  });

  // ── Test 5: Symptom entry appears on the /entries page ─────────────────
  // After the auto-redirect, the /entries page should render the
  // "Kopfschmerzen" (headache) symptom entry in the merged timeline.
  test("headache entry is visible on /entries after saving", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/engine?tab=symptoms", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/engine/, { timeout: 30_000 });

    const headacheChip = page.getByRole("button", { name: "Kopfschmerzen" });
    await expect(headacheChip).toBeVisible({ timeout: 120_000 });
    await headacheChip.click();

    const group = page.locator('[role="radiogroup"][aria-label="Kopfschmerzen"]');
    await expect(group).toBeVisible({ timeout: 5_000 });

    const saveBtn = page.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/symptoms") && resp.status() === 201,
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const resp = await responsePromise.catch(() => null);
    if (resp) {
      try {
        const body = await resp.json() as { log?: { id?: string } };
        if (body.log?.id) insertedSymptomIds.push(body.log.id);
      } catch {}
    }

    await page.waitForURL(/\/entries/, { timeout: 30_000 });

    // The entries page renders symptom tokens as chip labels —
    // "Kopfschmerzen" must appear at least once in the timeline.
    const kopfschmerzText = page.locator("text=Kopfschmerzen").first();
    await expect(kopfschmerzText).toBeVisible({ timeout: 30_000 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Insights card — renders without crashing after cycle + symptom saves
// ───────────────────────────────────────────────────────────────────────────

test.describe("Insights — Zyklus & Symptome card renders", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await pinGermanLocale(context, baseURL!);
    await loginAsTestUser(page);
  });

  // ── Test 6: The cycle/symptom Insights card is present and not empty ───
  // After entries exist (from earlier tests or pre-existing data), the
  // /insights page must render the "Zyklus & Symptome" card without a
  // crash or uncaught error.  We do not assert on specific metric values
  // because the card adapts to the available data window.
  test("Insights page renders the Zyklus & Symptome card without crashing", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/insights", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForURL(/\/insights/, { timeout: 30_000 });

    // The card title is "Zyklus & Symptome" (when cycle surfaces are visible,
    // i.e. sex !== 'male') or "Symptome" (for male users or when only
    // symptom data exists).  Both texts share the word "Symptome".
    const cardTitle = page.locator("text=Symptome").first();
    await expect(cardTitle).toBeVisible({ timeout: 120_000 });

    // Confirm no full-page error banner is shown (a crash would render a
    // React error boundary or a Next.js error page).
    await expect(page.locator("text=Application error")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.locator("text=Something went wrong")).not.toBeVisible({ timeout: 3_000 });
  });
});
