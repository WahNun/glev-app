// End-to-end coverage for the Drip-Cron unsubscribe suppression
// (Task #169).
//
// Why this exists:
//   `tests/e2e/drip-unsubscribe.spec.ts` (Task #164) covers the
//   GET /api/email/drip/unsubscribe endpoint — writing to
//   `email_drip_unsubscribes` and marking pending schedule rows as
//   sent. What it does NOT cover is the second half of the guarantee:
//   that the nightly cron in `app/api/cron/drip/route.ts` skips
//   addresses in `email_drip_unsubscribes` even when a brand-new
//   schedule row appears after the unsubscribe (e.g. a second
//   purchase or a different tier). A regression in the filter —
//   say a missing `.in("email", suppressionList)` — would silently
//   send mail to unsubscribed recipients without anyone noticing.
//
// What this asserts:
//   1. An address is pre-inserted into `email_drip_unsubscribes`.
//   2. A new, overdue schedule row (sent_at IS NULL) is created for
//      the same address, simulating a post-unsubscribe re-enqueue.
//   3. The cron endpoint is called with the correct Bearer token.
//   4. The cron response reports sent=0 and skipped≥1.
//   5. The schedule row now has `sent_at` set (cron marks it to
//      avoid re-selecting it on subsequent ticks).
//   6. No email outbox entry was created for the address (belt &
//      suspenders: the cron calls Resend directly, but we verify
//      the email is absent from email_outbox too, in case the code
//      path ever changes).
//
// The test drives the endpoint via Playwright's `request` fixture —
// no browser needed, same pattern as drip-unsubscribe.spec.ts.
// Cleanup runs in beforeEach + afterAll to leave the DB clean even
// after a failed test run.

import { expect, test } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Dedicated `.test` TLD address — non-routable by design.
// Different from the one in drip-unsubscribe.spec.ts to avoid
// shared cleanup collisions when both suites run in parallel.
const TEST_EMAIL = "playwright-drip-cron-suppress@glev.test";

// ------------------------------------------------------------------ helpers

function getAdminClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "drip-cron-suppression spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Hard-delete every drip artifact for the test address.
 * Called both in beforeEach (clean baseline) and afterAll
 * (ensure no pollution from a crashed run).
 */
async function cleanup(admin: SupabaseClient) {
  const errors: string[] = [];

  const { error: e1 } = await admin
    .from("email_drip_schedule")
    .delete()
    .eq("email", TEST_EMAIL);
  if (e1) errors.push(`email_drip_schedule: ${e1.message}`);

  const { error: e2 } = await admin
    .from("email_drip_unsubscribes")
    .delete()
    .eq("email", TEST_EMAIL);
  if (e2) errors.push(`email_drip_unsubscribes: ${e2.message}`);

  // Belt & suspenders: also clear any accidental outbox entries.
  const { error: e3 } = await admin
    .from("email_outbox")
    .delete()
    .eq("recipient_email", TEST_EMAIL);
  // Ignore PGRST116 (relation does not exist) — the outbox table may
  // not be present in all environments. Any other error is surfaced.
  if (e3 && !e3.message.includes("does not exist")) {
    errors.push(`email_outbox: ${e3.message}`);
  }

  if (errors.length > 0) {
    throw new Error(`cleanup failed:\n  ${errors.join("\n  ")}`);
  }
}

/**
 * Insert the test address into the global suppression list.
 * `source = "test"` to distinguish from real unsubscribe clicks.
 */
async function insertUnsubscribeEntry(admin: SupabaseClient) {
  const { error } = await admin
    .from("email_drip_unsubscribes")
    .insert({ email: TEST_EMAIL, source: "test" });
  if (error) {
    throw new Error(
      `failed to seed email_drip_unsubscribes: ${error.message}`,
    );
  }
}

/**
 * Insert one overdue schedule row (sent_at IS NULL, scheduled_at
 * 2 hours in the past) — exactly what a post-unsubscribe re-enqueue
 * would look like. The cron's `sent_at IS NULL + scheduled_at ≤ now`
 * filter picks it up; the suppression check must then stop it from
 * being sent.
 *
 * We use `day14_feedback` here (vs `day7_insights` in the unsubscribe
 * spec) so the two specs can run concurrently against the same DB
 * without the unique `(email, email_type)` index causing conflicts.
 */
async function insertOverdueScheduleRow(
  admin: SupabaseClient,
): Promise<string> {
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("email_drip_schedule")
    .insert({
      email: TEST_EMAIL,
      first_name: "Toni",
      tier: "beta",
      email_type: "day14_feedback",
      scheduled_at: past,
      sent_at: null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `failed to seed email_drip_schedule row: ${error?.message ?? "no row returned"}`,
    );
  }
  return data.id as string;
}

async function readScheduleSentAt(
  admin: SupabaseClient,
  rowId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("email_drip_schedule")
    .select("sent_at")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(`schedule read failed: ${error.message}`);
  return (data?.sent_at ?? null) as string | null;
}

async function outboxEntryExists(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("email_outbox")
      .select("id")
      .eq("recipient_email", TEST_EMAIL)
      .limit(1)
      .maybeSingle();
    if (error) return false; // table might not exist — treat as "no entry"
    return data !== null;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ suite

test.describe("Drip cron skips unsubscribed recipients", () => {
  let admin: SupabaseClient;

  test.beforeAll(() => {
    if (!process.env.CRON_SECRET) {
      throw new Error(
        "drip-cron-suppression spec needs CRON_SECRET env var",
      );
    }
    admin = getAdminClient();
  });

  test.beforeEach(async () => {
    await cleanup(admin);
  });

  test.afterAll(async () => {
    if (admin) await cleanup(admin);
  });

  test(
    "cron skips a post-unsubscribe schedule row: sent=0, skipped=1, row marked sent_at, no outbox entry",
    async ({ request, baseURL }) => {
      const base = baseURL ?? "http://localhost:5000";

      // ---- ARRANGE -------------------------------------------------
      // 1. Pre-populate the global suppression list.
      await insertUnsubscribeEntry(admin);

      // 2. Create a new overdue schedule row as if the address was
      //    re-enrolled after unsubscribing (e.g. second purchase).
      const scheduleId = await insertOverdueScheduleRow(admin);

      // Sanity: row is pending, no outbox entry yet.
      expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();
      expect(await outboxEntryExists(admin)).toBe(false);

      // ---- ACT -----------------------------------------------------
      // 3. Fire the cron endpoint (POST — same as GitHub Actions does).
      const res = await request.post(`${base}/api/cron/drip`, {
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      // ---- ASSERT: HTTP response -----------------------------------
      // 4a. Must succeed (200 OK with JSON body).
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"] ?? "").toMatch(/application\/json/);

      const body = (await res.json()) as {
        ok: boolean;
        sent: number;
        failed: number;
        skipped: number;
      };

      // 4b. The address must have been skipped, not sent.
      expect(body.ok).toBe(true);
      expect(body.sent).toBe(0);
      // `skipped` must be at least 1 (our row). Another concurrent
      // test row could bump it higher, but 0 means our row slipped
      // through the filter.
      expect(body.skipped).toBeGreaterThanOrEqual(1);

      // ---- ASSERT: DB side effects --------------------------------
      // 5. The schedule row must now be marked `sent_at IS NOT NULL`
      //    so subsequent cron ticks don't re-select it.
      await expect
        .poll(() => readScheduleSentAt(admin, scheduleId), { timeout: 5_000 })
        .not.toBeNull();

      // 6. No outbox entry must exist for the address — belt &
      //    suspenders check in case the send path ever routes through
      //    the outbox table in future refactors.
      expect(await outboxEntryExists(admin)).toBe(false);
    },
  );

  test(
    "cron without valid Bearer token returns 401 and leaves DB unchanged",
    async ({ request, baseURL }) => {
      const base = baseURL ?? "http://localhost:5000";

      // Seed data so we can verify nothing was mutated on 401.
      await insertUnsubscribeEntry(admin);
      const scheduleId = await insertOverdueScheduleRow(admin);
      expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();

      const res = await request.post(`${base}/api/cron/drip`, {
        headers: { Authorization: "Bearer wrong-secret" },
      });

      expect(res.status()).toBe(401);

      // Give a short window for any out-of-band write to surface.
      await new Promise((r) => setTimeout(r, 250));
      expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();
    },
  );
});
