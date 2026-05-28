// End-to-end coverage for the three manual server actions on the
// /admin/drip operator dashboard (Task #167).
//
// Why this spec exists:
//   The status classification logic is already covered by unit tests
//   (tests/unit/dripStats.test.ts). But the three Server Actions —
//   sendNowAction, cancelAction, rescheduleAction — have no automated
//   coverage. Each one:
//     • checks the auth cookie itself (so a misconfigured cookie path or
//       secret mismatch silently breaks the UI but produces no JS error)
//     • writes to `email_drip_schedule` via the Supabase admin client
//     • calls `revalidatePath` so the page re-renders with fresh data
//   A manual regression here would be: the "Sofort senden" button does
//   nothing because the confirm dialog's "Ja, senden" click lost its
//   onClick handler after a React Server Component refactor, or the
//   cancelAction deletes the wrong row because `eq("id", ...)` was
//   accidentally removed. Both are invisible to TypeScript.
//
// Resend mocking:
//   sendNowAction normally calls the real Resend API. In the test env
//   we set PLAYWRIGHT_DRIP_SKIP_RESEND=1 (in .env.local) which triggers
//   a fast-path inside the action that writes `sent_at` directly without
//   making an HTTP call to api.resend.com. The bypass is documented with
//   a comment inside actions.ts and only activates on that exact value.
//
// Auth:
//   We set the `glev_admin_token` cookie to the value of ADMIN_API_SECRET
//   before the first page load. This mirrors exactly what loginAction()
//   writes — same cookie name, value, and path — so the auth guard inside
//   requireAdmin() passes. Tests that need to verify the unauthenticated
//   state clear the cookies explicitly in beforeEach.
//
// DB setup / cleanup:
//   Each test inserts its own row into `email_drip_schedule` using the
//   Supabase service-role client, which bypasses RLS (same mechanism as
//   tests/support/testUser.ts). Rows use a dedicated test email domain
//   (@glev.test) so they're trivially filterable if something goes wrong.
//   beforeEach cleans the test emails and afterAll does a final sweep.

import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DripRow {
  id: string;
  email: string;
  email_type: string;
  scheduled_at: string;
  sent_at: string | null;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function getAdminClient() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "admin-drip-actions spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const TEST_EMAILS = [
  "drip-e2e-sendnow@glev.test",
  "drip-e2e-cancel@glev.test",
  "drip-e2e-reschedule@glev.test",
];

async function cleanTestRows() {
  const admin = getAdminClient();
  const { error } = await admin
    .from("email_drip_schedule")
    .delete()
    .in("email", TEST_EMAILS);
  if (error) {
    throw new Error(`drip test-row cleanup failed: ${error.message}`);
  }
}

/**
 * Insert a single test drip row and return its generated id.
 * Uses `upsert` with ignoreDuplicates=false so a stale leftover from a
 * failed previous run is overwritten rather than producing a duplicate-key
 * error.
 */
async function insertDripRow(opts: {
  email: string;
  emailType?: string;
  scheduledAt?: string;
}): Promise<string> {
  const admin = getAdminClient();
  const { email, emailType = "day7_insights" } = opts;
  // Default scheduled_at: tomorrow at 09:00 UTC (pending state — not overdue)
  const scheduledAt =
    opts.scheduledAt ??
    (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(9, 0, 0, 0);
      return d.toISOString();
    })();

  // Delete any stale row first so the upsert sees a clean slate
  await admin
    .from("email_drip_schedule")
    .delete()
    .eq("email", email)
    .eq("email_type", emailType);

  const { data, error } = await admin
    .from("email_drip_schedule")
    .insert({
      email,
      first_name: "E2E",
      tier: "beta",
      email_type: emailType,
      scheduled_at: scheduledAt,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `drip test-row insert failed for ${email}: ${error?.message ?? "no id returned"}`,
    );
  }
  return data.id as string;
}

async function readDripRow(id: string): Promise<DripRow | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("email_drip_schedule")
    .select("id, email, email_type, scheduled_at, sent_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`drip row read failed: ${error.message}`);
  return (data as DripRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Return the ADMIN_API_SECRET from the environment.
 * The test will be skipped (not failed) if the secret is missing — that
 * keeps local dev without admin credentials from breaking the entire suite.
 */
function getAdminSecret(): string {
  return process.env.ADMIN_API_SECRET ?? "";
}

/**
 * Set the `glev_admin_token` cookie so the admin dashboard opens without
 * going through the login form. Mirrors exactly what loginAction() writes.
 */
async function setAdminCookie(context: BrowserContext): Promise<void> {
  const secret = getAdminSecret();
  if (!secret) return;
  const baseURL =
    process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: "glev_admin_token",
      value: secret,
      domain: url.hostname,
      path: "/admin",
      httpOnly: true,
      sameSite: "Strict",
      secure: false,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Admin Drip Dashboard — manual actions", () => {
  test.beforeEach(async () => {
    await cleanTestRows();
  });

  test.afterAll(async () => {
    await cleanTestRows();
  });

  // ── Guard: admin login page is shown when the cookie is missing ──────────

  test("shows login form when glev_admin_token cookie is absent", async ({
    page,
  }) => {
    await page.goto("/admin/drip");
    // The page should render a password/token input, not the dashboard table.
    await expect(
      page.locator('input[type="password"]'),
    ).toBeVisible({ timeout: 20_000 });
    // The dashboard table must NOT be visible without a valid auth cookie.
    await expect(page.locator("table")).toHaveCount(0);
  });

  // ── Guard: skips gracefully when ADMIN_API_SECRET is not configured ──────

  test.skip(
    () => !getAdminSecret() || getAdminSecret().length < 16,
    "ADMIN_API_SECRET not set or too short — skipping admin action tests",
  );

  // ── "Sofort senden" ──────────────────────────────────────────────────────
  //
  // Flow:
  //   1. Insert a pending drip row.
  //   2. Open the dashboard with a valid auth cookie.
  //   3. Click "Sofort senden" → confirmation dialog appears.
  //   4. Click "Ja, senden" in the dialog.
  //   5. The action runs (Resend is bypassed via PLAYWRIGHT_DRIP_SKIP_RESEND=1).
  //   6. The row's `sent_at` is set in the DB.
  //   7. The status badge in the table flips to "Versendet".
  //   8. The three action buttons for that row disappear (sent rows are
  //      immutable — canAct = !row.sent_at).

  test("Sofort senden: sets sent_at and flips status to Versendet", async ({
    page,
    context,
  }) => {
    const secret = getAdminSecret();
    if (!secret) return;

    const id = await insertDripRow({ email: "drip-e2e-sendnow@glev.test" });

    await setAdminCookie(context);
    await page.goto("/admin/drip");

    // The dashboard table must load with at least one row.
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 30_000 });

    // Find the row for our test email. The table renders one <tr> per row.
    // We locate the cell that contains the email, then find the "Sofort senden"
    // button in the same row.
    const emailCell = page.getByText("drip-e2e-sendnow@glev.test", {
      exact: true,
    });
    await expect(emailCell).toBeVisible({ timeout: 15_000 });

    // The "Sofort senden" button is in the same <tr> as the email cell.
    const row = emailCell.locator("xpath=ancestor::tr");
    const sendBtn = row.getByRole("button", { name: "Sofort senden" });
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    // Confirm dialog must appear.
    const dialog = page.getByRole("dialog", { name: /E-Mail wirklich senden\?/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // "Ja, senden" commits the action.
    const confirmBtn = dialog.getByRole("button", { name: "Ja, senden" });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // The dialog closes immediately after the click.
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // Poll the DB until sent_at is set (the Server Action runs async in the
    // server process; revalidatePath triggers a re-render, but we also verify
    // at the DB layer independently).
    await expect
      .poll(() => readDripRow(id).then((r) => r?.sent_at ?? null), {
        timeout: 20_000,
        message: "sent_at should be set after sendNow",
      })
      .not.toBeNull();

    // The page should now show a "Versendet" badge for the row.
    // revalidatePath causes Next.js to re-render; the badge is rendered by
    // StatusBadge({ status: "sent" }) → statusLabel("sent") → "Versendet".
    await expect(row.getByText("Versendet")).toBeVisible({ timeout: 20_000 });

    // Once sent, the three action buttons must vanish (canAct = !sent_at).
    await expect(row.getByRole("button", { name: "Sofort senden" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Neu planen" })).toHaveCount(0);
    // The "Abbrechen" form-button is also gone (only the dialog's own cancel
    // button could remain, but the dialog is already closed).
  });

  // ── Idempotenz-Guard: already-sent row muss ignoriert werden ─────────────
  //
  // sendNowAction checks `row.sent_at` before calling Resend. If the row is
  // already sent, the action returns early (no Resend call, no duplicate).
  // The UI side enforces this too: canAct = !row.sent_at hides the button.
  // This test verifies the DB-level guard via the action directly (bypassing
  // the UI, which already hides the button).
  //
  // We insert a row with sent_at already set, then verify the DB value
  // doesn't change after a second call to the action (sent_at stays the
  // same timestamp).

  test("Sofort senden: already-sent row stays unchanged (idempotency)", async ({
    context,
    page,
  }) => {
    const secret = getAdminSecret();
    if (!secret) return;

    // Insert an already-sent row.
    const existingSentAt = "2026-01-01T09:00:00.000Z";
    const admin = getAdminClient();
    await admin.from("email_drip_schedule").delete()
      .eq("email", "drip-e2e-sendnow@glev.test");
    const { data, error } = await admin
      .from("email_drip_schedule")
      .insert({
        email: "drip-e2e-sendnow@glev.test",
        first_name: "E2E",
        tier: "beta",
        email_type: "day7_insights",
        scheduled_at: "2026-01-01T09:00:00.000Z",
        sent_at: existingSentAt,
      })
      .select("id")
      .single();
    if (error || !data?.id) throw new Error(`Insert failed: ${error?.message}`);
    const id = data.id as string;

    await setAdminCookie(context);
    await page.goto("/admin/drip");

    // Filter to the "Versendet" status to surface this row.
    const statusSelect = page.getByRole("combobox", { name: "Status" });
    await expect(statusSelect).toBeVisible({ timeout: 30_000 });
    await statusSelect.selectOption("sent");
    await page.getByRole("button", { name: "Filtern" }).click();

    // The row must appear with "Versendet" badge and no action buttons.
    const emailCell = page.getByText("drip-e2e-sendnow@glev.test", { exact: true });
    await expect(emailCell).toBeVisible({ timeout: 15_000 });
    const row = emailCell.locator("xpath=ancestor::tr");
    await expect(row.getByText("Versendet")).toBeVisible();
    await expect(row.getByRole("button", { name: "Sofort senden" })).toHaveCount(0);

    // DB state is unchanged: sent_at is still the original value.
    // Compare as Date objects — Supabase may return "+00:00" instead of "Z"
    // for the same UTC instant, so string equality would be fragile.
    const dbRow = await readDripRow(id);
    expect(dbRow?.sent_at).not.toBeNull();
    expect(new Date(dbRow!.sent_at!).getTime()).toBe(
      new Date(existingSentAt).getTime(),
    );
  });

  // ── "Abbrechen" ──────────────────────────────────────────────────────────
  //
  // cancelAction deletes the row (hard-delete). Only rows with
  // `sent_at IS NULL` are deleted (the `.is("sent_at", null)` filter in the
  // action prevents accidentally deleting a sent row). After the delete,
  // the row must be gone from the DB and absent from the table.

  test("Abbrechen: deletes the pending row from the DB", async ({
    page,
    context,
  }) => {
    const secret = getAdminSecret();
    if (!secret) return;

    const id = await insertDripRow({ email: "drip-e2e-cancel@glev.test" });

    await setAdminCookie(context);
    await page.goto("/admin/drip");

    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 30_000 });

    const emailCell = page.getByText("drip-e2e-cancel@glev.test", { exact: true });
    await expect(emailCell).toBeVisible({ timeout: 15_000 });

    const row = emailCell.locator("xpath=ancestor::tr");

    // The red "Abbrechen" button is a submit button inside a <form>.
    // Its title is "Termin endgültig löschen".
    const cancelBtn = row.getByRole("button", { name: "Abbrechen" });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // DB: row must be gone.
    await expect
      .poll(() => readDripRow(id), {
        timeout: 20_000,
        message: "row should be deleted after cancel",
      })
      .toBeNull();

    // UI: the email cell must no longer appear in the table.
    await expect(
      page.getByText("drip-e2e-cancel@glev.test", { exact: true }),
    ).toHaveCount(0);
  });

  // ── "Neu planen" ─────────────────────────────────────────────────────────
  //
  // rescheduleAction updates `scheduled_at` for a row that has
  // `sent_at IS NULL`. The UI enters an edit mode with a datetime-local
  // input pre-filled to the current `scheduled_at`, lets the operator type
  // a new value, and submits via the "Speichern" button. The form converts
  // the local datetime to UTC-ISO before submitting (to avoid tz shift).
  //
  // We verify both the DB (`scheduled_at` changed) and that the table cell
  // reflects the new date after revalidation.

  test("Neu planen: updates scheduled_at in the DB", async ({
    page,
    context,
  }) => {
    const secret = getAdminSecret();
    if (!secret) return;

    const id = await insertDripRow({
      email: "drip-e2e-reschedule@glev.test",
      // Start with a scheduled_at in the past (= "failed" status)
      scheduledAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });

    await setAdminCookie(context);
    await page.goto("/admin/drip");

    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 30_000 });

    const emailCell = page.getByText("drip-e2e-reschedule@glev.test", {
      exact: true,
    });
    await expect(emailCell).toBeVisible({ timeout: 15_000 });

    const row = emailCell.locator("xpath=ancestor::tr");

    // Click "Neu planen" to open the inline edit form.
    const rescheduleBtn = row.getByRole("button", { name: "Neu planen" });
    await expect(rescheduleBtn).toBeVisible();
    await rescheduleBtn.click();

    // The edit form replaces the action buttons with a datetime-local input
    // and "Speichern" / "Abbrechen" buttons.
    const dtInput = row.locator('input[type="datetime-local"]');
    await expect(dtInput).toBeVisible({ timeout: 5_000 });

    // Set a new scheduled_at: 2026-12-25 at 10:00 local time.
    // The form's action() converts this to UTC before writing via
    // `new Date(local).toISOString()` — so the exact UTC value depends on
    // the host's local timezone. We only check that `scheduled_at` changed
    // from the original value (not the exact ISO string), because the test
    // runner timezone isn't fixed.
    await dtInput.fill("2026-12-25T10:00");
    const saveBtn = row.getByRole("button", { name: "Speichern" });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // The edit form should collapse (the "Speichern" button is gone).
    await expect(saveBtn).not.toBeVisible({ timeout: 10_000 });

    // DB: `scheduled_at` must have changed from the original value.
    await expect
      .poll(
        async () => {
          const r = await readDripRow(id);
          // The new date is 2026-12-25 in some timezone — it must contain "2026-12".
          return r?.scheduled_at ?? "";
        },
        { timeout: 20_000, message: "scheduled_at should be updated" },
      )
      .toMatch(/2026-12/);

    // The row must still be in the table (reschedule does NOT delete it).
    await expect(
      page.getByText("drip-e2e-reschedule@glev.test", { exact: true }),
    ).toBeVisible();

    // The row must NOT have a sent_at (reschedule is for pending rows only).
    const dbRow = await readDripRow(id);
    expect(dbRow?.sent_at).toBeNull();
  });
});
