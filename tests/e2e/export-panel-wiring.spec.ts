// End-to-end coverage for the wiring layer in `components/ExportPanel.tsx`.
//
// Why this exists:
//   The CSV exporters (`mealsToCSV`, `insulinToCSV`) and the PDF
//   `<GlevReport>` are well-tested in isolation under `tests/unit/`
//   and `tests/e2e/carb-unit-export.spec.ts` — they all behave
//   correctly when given the right unit / ICR / CF arguments. But
//   the call site that actually threads the user's settings INTO
//   those callees (`ExportPanel.tsx`) is its own bug surface: passing
//   `null` instead of `undefined`, the wrong unit, or forgetting to
//   forward the correction factor would silently produce a wrong file
//   for the user even though every pure-function test still passes.
//   This spec drives the real panel against a real signed-in user
//   with known settings and asserts the file the user downloads
//   actually carries those settings.
//
// What this asserts (and why each piece matters):
//   1. Insulin CSV download:
//      - filename starts with `glev-insulin_`
//      - header row contains the BE-tagged `icr_be_per_ie (BE/IE)`
//        column (proves carbUnit reaches `insulinToCSV`)
//      - header row contains `cf_mgdl_per_ie (mg/dL/IE)` (proves the
//        correction factor was forwarded — the bug class the task
//        explicitly calls out: "forgets to forward the correction
//        factor at all")
//      - the seeded row's ICR cell is the converted value (12 g/IE
//        → 1 BE/IE) and CF cell is the configured 60. A regression
//        that swapped null/undefined or routed the wrong field would
//        emit blanks or the unconverted gram value here.
//   2. Meals CSV download:
//      - filename starts with `glev-mahlzeiten_`
//      - header has `carbs_be (BE)` (NOT `carbs_grams (g)`)
//      - the seeded 60g meal renders as 5 in the BE cell.
//   3. PDF report wiring:
//      - the props that would be handed to `<GlevReport>` carry the
//        user's `carbUnit: "BE"`, `icrGperIE: 12`, `cfMgdlPerIE: 60`.
//      - asserted via a test-only probe (`__GLEV_CAPTURE_PDF_PROPS__`)
//        which mirrors the props bag and short-circuits the real
//        ~400KB renderer. The probe path is gated on the global being
//        a function — it has no effect in production builds.
//
// We deliberately drive the panel through the real login flow rather
// than seeding cookies, so the test catches regressions in any layer
// between login → middleware → settings page → ExportPanel mount →
// fetch effects → download/probe handlers.

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
 * Service-role admin client. We can't go through the normal helpers
 * because they require an authenticated browser session; the admin
 * client bypasses RLS so we can prepare DB state before the test
 * navigates anywhere. Mirrors the pattern used in
 * `carb-unit-picker.spec.ts` and `insulin-settings.spec.ts`.
 */
function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "export-panel-wiring spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Pin the user's exporter-relevant settings: carb unit (profiles
 * table) + ICR + CF (user_settings table). The values are the same
 * canonical fixture the unit suites use:
 *   - carb_unit  = "BE"   → 60g meal renders as 5 BE
 *   - icr        = 12 g/IE → 1 BE/IE after icrToUnit
 *   - cf         = 60 mg/dL/IE
 * so any regression in unit/ICR/CF threading shows up as a clearly
 * wrong cell or a missing column rather than a hard-to-spot rounding
 * difference.
 */
async function applyExportSettings(userId: string, opts: {
  carbUnit: "g" | "BE" | "KE";
  icrGperUnit: number;
  cfMgdlPerUnit: number;
}) {
  const admin = getAdminClient();
  const { error: profErr } = await admin
    .from("profiles")
    .update({ carb_unit: opts.carbUnit })
    .eq("user_id", userId);
  if (profErr) throw new Error(`profiles update failed: ${profErr.message}`);
  const { error: settingsErr } = await admin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        icr_g_per_unit: opts.icrGperUnit,
        cf_mgdl_per_unit: opts.cfMgdlPerUnit,
      },
      { onConflict: "user_id" },
    );
  if (settingsErr) throw new Error(`user_settings upsert failed: ${settingsErr.message}`);
  // Defensive read-back — earlier `npm test` runs surfaced a
  // failure mode where the panel saw `icr_g_per_unit: null` even
  // after this upsert returned without error. Reading the row
  // back through the admin client (bypassing RLS) and asserting
  // on the values turns any silent upsert oddity (column-level
  // RLS, replication, or row-not-actually-written) into a clear
  // beforeEach error pinned to this helper instead of a
  // confusing "missing CSV column" failure 30 seconds later.
  const { data: verifyRow, error: verifyErr } = await admin
    .from("user_settings")
    .select("icr_g_per_unit, cf_mgdl_per_unit")
    .eq("user_id", userId)
    .maybeSingle();
  if (verifyErr) throw new Error(`user_settings verify read failed: ${verifyErr.message}`);
  if (
    verifyRow?.icr_g_per_unit !== opts.icrGperUnit ||
    verifyRow?.cf_mgdl_per_unit !== opts.cfMgdlPerUnit
  ) {
    throw new Error(
      `user_settings post-upsert mismatch — expected ` +
        `icr=${opts.icrGperUnit} cf=${opts.cfMgdlPerUnit}, got ` +
        `icr=${verifyRow?.icr_g_per_unit} cf=${verifyRow?.cf_mgdl_per_unit}`,
    );
  }
}

/**
 * Restore the user's settings to the suite-wide baseline so other
 * specs that assert on the default fallbacks ("g" / null ICR / null
 * CF) aren't surprised by the values we pinned in beforeEach.
 */
async function resetExportSettings(userId: string) {
  const admin = getAdminClient();
  await admin
    .from("profiles")
    .update({ carb_unit: "g" })
    .eq("user_id", userId);
  await admin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        icr_g_per_unit: null,
        cf_mgdl_per_unit: null,
      },
      { onConflict: "user_id" },
    );
}

/**
 * Seed exactly one meal at 60g and one bolus insulin log at 4 IE so
 * the panel has at least one row per kind the assertions read. 60g
 * was picked because it converts cleanly to 5 BE (no decimal noise
 * in the assertion). Both rows carry the FIXTURE_MARKER so the
 * cleanup helper can sweep them by tag rather than by id — that way
 * a prior afterEach that was cancelled mid-run can't leak orphan
 * rows into the next test's count assertions.
 */
async function seedFixtures(userId: string): Promise<void> {
  const admin = getAdminClient();
  // `.select()` after an insert blocks until the row is observable on
  // the same connection (PostgREST returns the inserted row only after
  // the write commits). Earlier `npm test` runs surfaced a flake where
  // the panel's HEAD count for `insulin_logs` returned 0 immediately
  // after the seed — forcing a select round-trip here turns "row not
  // committed yet" into a clear beforeEach error and pins the row's
  // server-issued id for the read-back below.
  const { data: mealRow, error: mealErr } = await admin
    .from("meals")
    .insert({
      user_id: userId,
      input_text: FIXTURE_MARKER,
      carbs_grams: 60,
    })
    .select("id")
    .single();
  if (mealErr) throw new Error(`meals seed failed: ${mealErr.message}`);
  const { data: insulinRow, error: insulinErr } = await admin
    .from("insulin_logs")
    .insert({
      user_id: userId,
      insulin_type: "bolus",
      insulin_name: "Humalog",
      units: 4,
      notes: FIXTURE_MARKER,
    })
    .select("id")
    .single();
  if (insulinErr) throw new Error(`insulin_logs seed failed: ${insulinErr.message}`);
  // Defensive read-back: confirm both rows are visible by primary
  // key BEFORE returning. Catches the rare case where a write returns
  // 201 but the row isn't yet observable to a subsequent SELECT (e.g.
  // a transient PostgREST connection-pool oddity), which would
  // otherwise surface 30s later as a confusing "CSV (0)" / button
  // disabled failure on the test body.
  const [{ data: mealReadback }, { data: insulinReadback }] = await Promise.all([
    admin.from("meals").select("id").eq("id", mealRow!.id).maybeSingle(),
    admin.from("insulin_logs").select("id").eq("id", insulinRow!.id).maybeSingle(),
  ]);
  if (!mealReadback) {
    throw new Error(`meals seed read-back missing — id=${mealRow!.id}`);
  }
  if (!insulinReadback) {
    throw new Error(`insulin_logs seed read-back missing — id=${insulinRow!.id}`);
  }
}

// Marker text we tag onto every seeded row so we can sweep ALL of
// our fixture rows for the test user — not just the ids we tracked
// in `seededIds`. This guards against the case where a prior
// afterEach was cancelled (e.g. by a test timeout) and left an
// orphan row behind: the next beforeEach would otherwise inherit
// that leftover and silently invalidate count assertions.
const FIXTURE_MARKER = "export-panel-wiring e2e fixture";

async function deleteAllFixturesFor(userId: string) {
  const admin = getAdminClient();
  const mealsRes = await admin
    .from("meals")
    .delete()
    .eq("user_id", userId)
    .eq("input_text", FIXTURE_MARKER);
  if (mealsRes.error) {
    throw new Error(`meals cleanup failed: ${mealsRes.error.message}`);
  }
  const insulinRes = await admin
    .from("insulin_logs")
    .delete()
    .eq("user_id", userId)
    .eq("notes", FIXTURE_MARKER);
  if (insulinRes.error) {
    throw new Error(`insulin_logs cleanup failed: ${insulinRes.error.message}`);
  }
}

// Locale-agnostic regexes for the labels we drive. The default app
// locale is "de" but Playwright's Chromium reports an English
// Accept-Language header by default, so the active locale at runtime
// can flip either way depending on the environment. Match both.
const EXPORT_ROW_ARIA = /(Open Export data|Export data öffnen|Open Daten exportieren|Daten exportieren öffnen)/i;
// Per-kind CSV button label ("CSV" or "CSV (n)"). The four rows are
// always rendered in the order [meals, insulin, exercise, fingersticks]
// (driven by the static `ROWS` array in ExportPanel.tsx), so we
// disambiguate via .nth() after collecting all CSV buttons.
const CSV_BTN_LABEL = /^CSV( \(\d+\))?$/;
// The PDF button label gains an entry-count suffix once the count
// preview settles ("PDF Report" → "PDF Report (4)"), and flips to a
// progress label while the renderer is working. Matching all four
// shapes (EN/DE × idle/in-flight) with an optional `(n)` suffix lets
// the same locator survive the panel's full lifecycle.
const PDF_BTN_NAME = /^(PDF Report|PDF-Report|Building PDF…|Erstelle PDF…)( \(\d+\))?$/i;
// Count line ready signal — the panel renders this transient label
// while the count preview is in flight; once it disappears the per-
// row buttons reflect the real counts and `disabled` is settled.
const COUNT_LOADING = /Counting entries|Zähle Einträge/;

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

async function openExportSheet(page: Page) {
  await page.goto("/settings");
  const exportRow = page.getByRole("button", { name: EXPORT_ROW_ARIA }).first();
  await expect(exportRow).toBeVisible();
  // The /settings page itself reads user_settings (to render the
  // ICR / CF rows), so by the time we land here that response has
  // already fired and resolved. ExportPanel mount fires its OWN
  // user_settings query — we MUST wait for THAT one specifically
  // before clicking any export action, otherwise the panel's
  // `icrGperIE` / `cfMgdlPerIE` React state is still at its
  // initial `null` and the resulting CSV/PDF would be missing the
  // ICR column / forwarded CF (false-positive wiring failures).
  // Setting up the wait AFTER the row click ensures we only catch
  // the panel-fired response, not any stale settings-page response.
  // We additionally filter on the exact column projection the panel
  // uses (`icr_g_per_unit, cf_mgdl_per_unit` — and crucially NOT
  // `target_bg_mgdl`, which is what `lib/userSettings.ts`
  // `fetchInsulinSettings` adds to the projection when the /settings
  // page renders the ICR / CF / Target BG rows). Without this
  // negative match we'd risk catching the settings-page query
  // instead of the panel's, leaving the panel's own fetch racing
  // against the click that follows.
  const settingsResponse = page.waitForResponse(
    (r) =>
      /\/rest\/v1\/user_settings\b/.test(r.url()) &&
      /icr_g_per_unit/.test(r.url()) &&
      /cf_mgdl_per_unit/.test(r.url()) &&
      !/target_bg_mgdl/.test(r.url()) &&
      r.status() === 200,
    { timeout: 30_000 },
  );
  await exportRow.click();
  // The PDF button is rendered last in the panel — wait on it as the
  // readiness signal for "panel mounted, all effects fired".
  await expect(page.getByRole("button", { name: PDF_BTN_NAME })).toBeVisible({ timeout: 30_000 });
  // Wait for the count preview to settle so per-row button `disabled`
  // states reflect the real counts (otherwise an in-flight refresh
  // could still report rowCount === null and let an "empty" row look
  // enabled even when its true count is non-zero).
  await expect(page.getByText(COUNT_LOADING)).toHaveCount(0, { timeout: 15_000 });
  // Block until the panel's own user_settings fetch resolves — see
  // comment above. After this returns the panel's `icrGperIE` /
  // `cfMgdlPerIE` React state is guaranteed to reflect the value
  // we wrote in beforeEach.
  await settingsResponse;
}

/**
 * Convert a Playwright Download into a UTF-8 string with the BOM
 * stripped so call sites can index headers/rows directly. We always
 * read the bytes first (rather than .text()) because the helper that
 * writes the CSV prepends a `\uFEFF` BOM for Excel compatibility, and
 * a UTF-8 BOM in the headers row would leak into `headers[0]` and
 * break exact-match assertions like `expect(headers).toContain(...)`.
 */
async function readDownloadAsCSV(download: import("@playwright/test").Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("Download path was null — Playwright failed to persist the file");
  const bytes = fs.readFileSync(path);
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

/**
 * Pull the value for a given header from a CSV row. CSV here is
 * naïvely split on commas — none of the values we read in this spec
 * (insulin type, units, ICR/CF numerics, meal carbs, ids/timestamps)
 * contain commas or embedded quotes, so a real RFC-4180 parser would
 * be overkill. Throws if the header is missing so a regression that
 * dropped a column fails loudly instead of silently returning "".
 */
function readColumn(csv: string, columnName: string, rowIndex = 0): string {
  const lines = csv.split(/\r?\n/);
  const headers = lines[0].split(",");
  const idx = headers.indexOf(columnName);
  if (idx === -1) {
    throw new Error(
      `Column "${columnName}" not found in headers: ${headers.join(" | ")}`,
    );
  }
  return lines[1 + rowIndex].split(",")[idx];
}

test.describe("ExportPanel wires user settings into the downloaded files", () => {
  let testUser: TestUser;

  test.beforeAll(() => {
    testUser = loadTestUser();
  });

  test.beforeEach(async ({ context }) => {
    // Pristine baseline: clear cookies, sweep any orphan fixture
    // rows from a previous run, pin the exporter-relevant settings
    // to a known fixture, and seed one meal + one insulin log so
    // each row has at least one entry to write into the CSV. The
    // upfront sweep matters because if a prior test's afterEach was
    // cancelled (timeout / process kill) we'd otherwise inherit two
    // marked rows into this test's count and break assertions like
    // "row[0] units == 4".
    await context.clearCookies();
    await deleteAllFixturesFor(testUser.userId);
    await applyExportSettings(testUser.userId, {
      carbUnit: "BE",
      icrGperUnit: 12,
      cfMgdlPerUnit: 60,
    });
    await seedFixtures(testUser.userId);
  });

  test.afterEach(async () => {
    // Restore the suite-wide baseline (no marked entries, default
    // carb unit, null ICR/CF) so neither this spec's repeated runs
    // nor downstream specs see leftover state. The sweep is
    // tag-scoped (FIXTURE_MARKER) so we never touch rows that
    // belong to other specs sharing the same Supabase test user.
    await deleteAllFixturesFor(testUser.userId);
    await resetExportSettings(testUser.userId);
  });

  test("Insulin CSV carries the BE-tagged ICR column AND the correction factor", async ({ page }) => {
    await loginAsTestUser(page);
    await openExportSheet(page);

    // The four per-kind rows render in fixed order [meals, insulin,
    // exercise, fingersticks] (driven by the static `ROWS` array in
    // ExportPanel.tsx). Pick the second CSV button — that's the
    // Insulin row.
    const csvButtons = page.getByRole("button", { name: CSV_BTN_LABEL });
    await expect(csvButtons).toHaveCount(4);
    const insulinCsvBtn = csvButtons.nth(1);
    await expect(insulinCsvBtn).toBeEnabled();

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await insulinCsvBtn.click();
    const download = await downloadPromise;

    // Filename pins us to the right CSV (defends against the row
    // ordering silently changing and us asserting on the wrong file).
    expect(download.suggestedFilename()).toMatch(/^glev-insulin_\d{4}-\d{2}-\d{2}.*\.csv$/);

    const csv = await readDownloadAsCSV(download);
    const headers = csv.split(/\r?\n/)[0].split(",");

    // ICR column tag MUST follow the user's chosen carb unit. With
    // carbUnit="BE" the column key is `icr_be_per_ie` and the unit
    // tag is `(BE/IE)`. A regression that passed the wrong carb unit
    // (or `null`/`undefined` in the wrong slot) would either drop
    // this column entirely or emit it under the gram-unit name.
    expect(headers).toContain("icr_be_per_ie (BE/IE)");
    // Defensive: the gram-unit column MUST NOT leak in alongside.
    expect(headers).not.toContain("icr_g_per_ie (g/IE)");

    // CF column is unit-independent (it's mg/dL per IE either way),
    // but its very presence is what the task is asking us to guard:
    // a wiring regression that "forgets to forward the correction
    // factor at all" would silently drop this column.
    expect(headers).toContain("cf_mgdl_per_ie (mg/dL/IE)");

    // ICR cell value: 12 g/IE through icrToUnit(_, "BE") = 1.
    // Asserts the conversion happened inside `insulinToCSV` (i.e.
    // the carb unit was actually threaded), not just that some ICR
    // value made it through.
    expect(readColumn(csv, "icr_be_per_ie (BE/IE)")).toBe("1");
    // CF cell value: configured 60 mg/dL/IE survives to the cell.
    expect(readColumn(csv, "cf_mgdl_per_ie (mg/dL/IE)")).toBe("60");

    // Sanity: the row we seeded made it through (units = 4). Without
    // this, a regression that emptied the insulin fetcher would let
    // the header assertions pass against a header-only CSV.
    expect(readColumn(csv, "units")).toBe("4");
  });

  test("Meals CSV carries the BE-tagged carbs column with the converted value", async ({ page }) => {
    await loginAsTestUser(page);
    await openExportSheet(page);

    const csvButtons = page.getByRole("button", { name: CSV_BTN_LABEL });
    await expect(csvButtons).toHaveCount(4);
    const mealsCsvBtn = csvButtons.nth(0);
    await expect(mealsCsvBtn).toBeEnabled();

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await mealsCsvBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^glev-mahlzeiten_\d{4}-\d{2}-\d{2}.*\.csv$/);

    const csv = await readDownloadAsCSV(download);
    const headers = csv.split(/\r?\n/)[0].split(",");

    // The header MUST flip to the BE-unit column when the user has
    // BE selected. A regression that forwarded the wrong carb unit
    // (or `null`/`undefined`) would emit the legacy `carbs_grams (g)`
    // column instead — invisible to the user until they read the PDF
    // cover and noticed the unit mismatch.
    expect(headers).toContain("carbs_be (BE)");
    expect(headers).not.toContain("carbs_grams (g)");

    // 60g / 12 g/BE = 5 BE — the canonical conversion.
    expect(readColumn(csv, "carbs_be (BE)")).toBe("5");
  });

  test("PDF wiring forwards carb unit + ICR + CF to <GlevReport>", async ({ page }) => {
    // Bridge the in-page probe to the Node test process via a Playwright
    // exposed function. The probe lives in ExportPanel.tsx (gated on
    // the global being a function — production code path is unaffected
    // when the global is unset). Wiring goes:
    //   ExportPanel  →  globalThis.__GLEV_CAPTURE_PDF_PROPS__(props)
    //                → window.__captureGlevPdfProps(props)            (exposeFunction binding)
    //                →   captured = props                              (test-side closure)
    let captured: Record<string, unknown> | null = null;
    await page.exposeFunction("__captureGlevPdfProps", (props: Record<string, unknown>) => {
      captured = props;
    });
    // addInitScript runs after every navigation BEFORE page scripts,
    // so the probe is in place before ExportPanel mounts and before
    // the user clicks anything. JSON-roundtrip the props so the
    // exposeFunction binding (which only marshals serializable
    // values) gets a clean object to copy across the bridge.
    await page.addInitScript(() => {
      (
        globalThis as unknown as {
          __GLEV_CAPTURE_PDF_PROPS__: (props: unknown) => void;
        }
      ).__GLEV_CAPTURE_PDF_PROPS__ = (props: unknown) => {
        const w = window as unknown as {
          __captureGlevPdfProps: (p: unknown) => void;
        };
        w.__captureGlevPdfProps(JSON.parse(JSON.stringify(props)));
      };
    });

    await loginAsTestUser(page);
    await openExportSheet(page);

    const pdfBtn = page.getByRole("button", { name: PDF_BTN_NAME });
    await expect(pdfBtn).toBeEnabled();
    await pdfBtn.click();

    // The probe fires synchronously inside `exportPdf` once the four
    // fetches resolve, so a poll is enough — no need for a separate
    // wait condition.
    await expect.poll(() => captured, { timeout: 15_000 }).not.toBeNull();
    const props = captured!;

    // The three settings the wiring layer is responsible for
    // forwarding. Each one is its own bug class:
    //   - carbUnit  : forwarded as the wrong literal → wrong column tag
    //                 in CSV / wrong meta line in PDF.
    //   - icrGperIE : `null` instead of the value → "Aktueller ICR"
    //                 line silently dropped from the PDF cover.
    //   - cfMgdlPerIE: never wired → "Korrekturfaktor" line dropped.
    expect(props.carbUnit).toBe("BE");
    expect(props.icrGperIE).toBe(12);
    expect(props.cfMgdlPerIE).toBe(60);

    // And the seeded rows reached the renderer (defends against a
    // regression that emptied the fetchers — the per-prop assertions
    // above could otherwise pass against an "empty PDF" payload).
    // Use >= 1 rather than === 1 because other specs in the same
    // suite may leave un-cleaned-up entries on the shared test user
    // (the wiring assertions above are what we actually care about;
    // this is just a "fetchers ran and returned data" guard).
    expect(props.mealsCount as number).toBeGreaterThanOrEqual(1);
    expect(props.insulinCount as number).toBeGreaterThanOrEqual(1);
  });
});
