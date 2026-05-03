// End-to-end coverage for the ICR-source three-way split (Task #212).
//
// Why this exists:
//   `lib/engine/adaptiveICR.ts` returns a split count per pairing
//   source (`pairedExplicitCount`, `pairedTimeWindowCount`, plus the
//   fallback to `meal.insulin_units`). That split is consumed by both
//   the Engine result panel (`tEngine("icr_source", …)`) and the
//   Insights ICR card (`tInsights("engine_icr_source", …)`) — and so
//   far has only been guarded by `tests/unit/adaptiveICR.test.ts`. A
//   regression that left the data shape correct but quietly stopped
//   threading the counts into the rendered string (or used the wrong
//   ICU plural / locale key) would slip past the unit suite. This
//   spec exercises the full read path:
//     • Real Supabase rows for the test user (3 final meals + 2
//       boluses, one explicitly tagged, one within the ±30-min
//       window).
//     • Real engine wizard navigation through to Step 3 ("Result")
//       so the user-visible "1 explizit getaggt · 1 zeitnah …" line
//       is actually rendered.
//     • Real Insights page render in BOTH German and English so a
//       missing translation key is exposed loudly.
//
// We seed via the service-role admin client (same pattern as
// `last-appointment.spec.ts` / `insulin-settings.spec.ts`). Network
// mocks for `/api/cgm/*` and `/api/chat-macros` mirror what
// `engine-trend-arrow.spec.ts` already does — the engine page hits
// these on mount and during chat input, and we don't want the test
// to depend on a connected CGM source.

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
      "icr-source-split spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Wipe meals + insulin logs for the test user so the seeded fixture
 *  is the only thing the engine sees. Hard delete (not "is final = false")
 *  because anything older than the seeded 5-day-old rows would otherwise
 *  also feed into `computeAdaptiveICR` and shift the split counts. */
async function resetEngineData(userId: string) {
  const admin = getAdminClient();
  const a = await admin.from("insulin_logs").delete().eq("user_id", userId);
  if (a.error) throw new Error(`insulin_logs reset failed: ${a.error.message}`);
  const b = await admin.from("meals").delete().eq("user_id", userId);
  if (b.error) throw new Error(`meals reset failed: ${b.error.message}`);
}

/** Seed three final meals + two boluses to drive a deterministic
 *  3-way split on `computeAdaptiveICR`:
 *    - meal A → bolus with explicit `related_entry_id` tag
 *    - meal B → un-tagged bolus within the ±30-min time window
 *    - meal C → no bolus, falls back to `meal.insulin_units`
 *
 *  Each meal carries `glucose_before=100`, `bg_2h=110`, `bg_2h_at` at
 *  meal_time + 120 min so `lifecycleFor` returns `state="final"` with
 *  a GOOD outcome (lib/engine/lifecycle.ts). All rows live ~5 days
 *  ago — comfortably inside the 90-day engine cutoff but far enough
 *  back that the +3h CGM jobs (which look at fresh rows) won't try
 *  to mutate them mid-test.
 *
 *  Returns the meal IDs so the bolus inserts can wire `related_entry_id`. */
async function seedThreeWaySplit(userId: string): Promise<{ mealA: string; mealB: string; mealC: string }> {
  const admin = getAdminClient();
  const FIVE_DAYS_AGO_MS = Date.now() - 5 * 86_400_000;
  // Spread the three meal times across morning / afternoon / evening
  // local hours of that day so they all clear the time-of-day bucket
  // floor cleanly. The exact hour-of-day doesn't matter for the
  // split-count assertion — only that the three rows survive the
  // lifecycle "final" gate.
  const meals = [0, 1, 2].map((i) => {
    const mealMs = FIVE_DAYS_AGO_MS + i * 3 * 3_600_000; // +0h, +3h, +6h
    const bg2hMs = mealMs + 120 * 60_000;
    return {
      user_id: userId,
      input_text: `icr-split-${i}`,
      parsed_json: [],
      glucose_before: 100,
      // The deployed test schema is missing the +3h-curve aggregate columns
      // (e.g. `min_bg_180`), so `fetchMeals` drops back to MID_COLS which
      // strips `bg_2h` / `outcome_state` from the wire payload. We therefore
      // ALSO populate the legacy `glucose_after` column — `lifecycleFor`
      // reads `bg_2h ?? glucose_after`, so on the MID_COLS path it still
      // sees a +10 mg/dL post-meal reading and returns state="final" with
      // a GOOD outcome (weight 1.0 in computeAdaptiveICR).
      bg_2h: 110,
      bg_2h_at: new Date(bg2hMs).toISOString(),
      glucose_after: 110,
      evaluation: "GOOD", // cached eval used by the legacy CORE/MID paths
      meal_time: new Date(mealMs).toISOString(),
      created_at: new Date(mealMs).toISOString(),
      carbs_grams: 50,
      insulin_units: 4, // used by meal C fallback; meals A/B will be paired
      meal_type: "BALANCED",
      outcome_state: "final",
    };
  });
  const inserted = await admin.from("meals").insert(meals).select("id, meal_time");
  if (inserted.error || !inserted.data) {
    throw new Error(`meals insert failed: ${inserted.error?.message ?? "no data"}`);
  }
  // PostgREST preserves insert order for batch inserts — but be defensive
  // and sort by meal_time ASC so [0]/[1]/[2] always map to the chronological
  // A/B/C even if the row order ever flipped.
  const sorted = [...inserted.data].sort((x, y) =>
    Date.parse(x.meal_time) - Date.parse(y.meal_time),
  );
  const [mealA, mealB, mealC] = sorted.map((r) => r.id as string);

  // Bolus #1 → explicit-tag pair to meal A.
  // Bolus #2 → un-tagged, created within ±30 min of meal B's meal_time
  //           so the time-window heuristic picks it up.
  const mealBTimeMs = Date.parse(sorted[1].meal_time);
  const boluses = [
    {
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: "Novorapid",
      units: 5,
      created_at: new Date(Date.parse(sorted[0].meal_time) + 60_000).toISOString(),
      related_entry_id: mealA,
    },
    {
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: "Novorapid",
      units: 4,
      // +5 min from meal B's meal_time — well inside the 30-min window.
      created_at: new Date(mealBTimeMs + 5 * 60_000).toISOString(),
      related_entry_id: null,
    },
    // Meal C deliberately gets no bolus → falls back to `meal.insulin_units`.
  ];
  const ins = await admin.from("insulin_logs").insert(boluses);
  if (ins.error) throw new Error(`insulin_logs insert failed: ${ins.error.message}`);

  return { mealA, mealB, mealC };
}

/** Mirrors the helper in `engine-trend-arrow.spec.ts` — pre-seed the
 *  `NEXT_LOCALE` cookie BEFORE any navigation so the very first
 *  server-rendered HTML already speaks the requested language. */
async function setLocaleCookie(context: BrowserContext, locale: "de" | "en") {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([{
    name: "NEXT_LOCALE",
    value: locale,
    domain: url.hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);
}

/** Stub the network endpoints the engine page hits on mount + while
 *  driving the chat → macros wizard transition. We don't care about
 *  the CGM responses (the test never asserts on the trend arrow); we
 *  just need them to resolve cheaply so the page doesn't sit on a
 *  pending request. */
async function installEngineNetworkMocks(page: Page) {
  await page.route("**/api/cgm/history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ current: null, history: [], source: "llu" }),
    });
  });
  await page.route("**/api/cgm/glucose", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: false, glucose: null }),
    });
  });
  await page.route("**/api/chat-macros", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Got it — 50 g carbs.",
        nutritionSource: "estimated",
        macros: { carbs: 50, protein: 10, fat: 5, fiber: 3, calories: 0 },
        description: "icr-split test meal",
        items: [],
      }),
    });
  });
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

/** Drive the engine wizard from Step 1 (chat) to Step 3 (result):
 *    1. Type something into chat → hits mocked /api/chat-macros, which
 *       fills macros and exposes the "Weiter zu Schritt 2" CTA.
 *    2. Click that CTA → lands on the macros review (Step 2).
 *    3. Click "Bolus berechnen" → runs the engine (handleRun),
 *       waits 600ms cosmetic delay, advances to Step 3 (result panel
 *       where the icr_source line is rendered). */
async function runEngineToResultStep(page: Page) {
  const chatInput = page.locator('input[placeholder]').first();
  await expect(chatInput).toBeVisible({ timeout: 30_000 });
  await chatInput.fill("icr-split test meal");
  await page.getByRole("button", { name: /^(Send|Senden)$/i }).click();
  // CTA exposed via aria-label, locale-agnostic.
  const advanceBtn = page.getByRole("button", { name: /(Continue to step 2|Weiter zu Schritt 2)/i });
  await expect(advanceBtn).toBeVisible({ timeout: 15_000 });
  await advanceBtn.click();
  // Step 2 — click "Bolus berechnen" / "Calculate bolus" to run the engine.
  const calcBtn = page.getByRole("button", { name: /(Bolus berechnen|Calculate bolus)/i });
  await expect(calcBtn).toBeVisible({ timeout: 15_000 });
  await calcBtn.click();
}

// Locale-keyed regex fragments the spec asserts on. Kept inline so any
// regression in messages/{de,en}.json (rename / delete / wording drift)
// trips this spec immediately. The exact wording matters because it's
// the user-visible payoff of the three-way split.
//
// Each fragment is a substring match on the COMPLETE rendered line:
//   Engine DE  : "KH-Faktor-Datenquelle (3 Mahlzeiten): 1 explizit getaggt · 1 zeitnah gepaart · 1 aus Mahlzeit-Spalte."
//   Insights DE: "1 explizit getaggt · 1 zeitnah gepaart · 1 aus Mahlzeit-Spalte (3 Mahlzeiten gesamt)"
//   Insights EN: "1 explicitly tagged · 1 time-window paired · 1 from meal column (3 meals total)"
const ENGINE_ICR_LINE_DE = /1\s+explizit getaggt\s+·\s+1\s+zeitnah gepaart\s+·\s+1\s+aus Mahlzeit-Spalte/;
const INSIGHTS_ICR_LINE_DE = /1\s+explizit getaggt\s+·\s+1\s+zeitnah gepaart\s+·\s+1\s+aus Mahlzeit-Spalte/;
const INSIGHTS_ICR_LINE_EN = /1\s+explicitly tagged\s+·\s+1\s+time-window paired\s+·\s+1\s+from meal column/;

test.describe("ICR-source three-way split — Engine + Insights render path", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    // Pristine baseline: clear cookies AND wipe meals/boluses so the
    // seeded 3-meal fixture is the only data the engine sees. Without
    // this a previous run's seeded rows could compound into a 6-meal
    // split (2 explicit / 2 time-window / 2 fallback) and flip the
    // assertion to "2 explizit getaggt · 2 zeitnah …".
    await context.clearCookies();
    await resetEngineData(testUser.userId);
    await seedThreeWaySplit(testUser.userId);
  });

  test.afterAll(async () => {
    // Defensive: leave the test user with no meals/boluses so any
    // sibling spec that asserts on an empty engine state isn't
    // surprised by stale rows.
    await resetEngineData(testUser.userId);
  });

  test("Engine result panel shows '1 explizit · 1 zeitnah · 1 aus Mahlzeit-Spalte' (DE)", async ({ page, context }) => {
    await setLocaleCookie(context, "de");
    await installEngineNetworkMocks(page);
    await loginAsTestUser(page);
    await page.goto("/engine");

    await runEngineToResultStep(page);

    // The result card sits inside Step 3. Wait for the dose label
    // (always rendered first) before asserting on the icr_source line —
    // otherwise the assertion could race the 600ms handleRun delay.
    await expect(page.getByText(/Empfohlene Dosis|Recommended dose/i).first())
      .toBeVisible({ timeout: 15_000 });

    // Substring match on the visible icr_source paragraph.
    await expect(page.getByText(ENGINE_ICR_LINE_DE).first())
      .toBeVisible({ timeout: 15_000 });
  });

  test("Insights ICR card shows the split in DE and EN", async ({ page, context }) => {
    // The Insights ICR card sits inside a CardFlip wrapper (page.tsx
    // ~L1665) that renders the front content TWICE: once as a
    // `visibility:"hidden"` ghost (sets parent height) and once inside
    // the actual flip stage. `.first()` unfortunately picks the ghost,
    // so every assertion below uses `.locator("visible=true").first()`
    // to scope to the on-screen copy.

    // ── DE ────────────────────────────────────────────────────────
    await setLocaleCookie(context, "de");
    await loginAsTestUser(page);
    await page.goto("/insights");
    // Wait for the localized engine-card label first so we don't race
    // the on-mount fetches that populate adaptiveICR.
    await expect(
      page.getByText(/^KH-FAKTOR$/).locator("visible=true").first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(INSIGHTS_ICR_LINE_DE).locator("visible=true").first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── EN ────────────────────────────────────────────────────────
    // Swap the locale cookie + reload — the same data must produce the
    // English equivalent of the line. A missing `engine_icr_source`
    // entry in messages/en.json (or a regression that bypasses the
    // locale-keyed lookup) would surface here as the German fragment
    // bleeding through into the EN render.
    await setLocaleCookie(context, "en");
    await page.goto("/insights");
    await expect(
      page.getByText(/^ICR$/).locator("visible=true").first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(INSIGHTS_ICR_LINE_EN).locator("visible=true").first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
