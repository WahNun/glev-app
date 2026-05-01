// End-to-end coverage for the Drip-Mail one-click unsubscribe flow
// (Task #164).
//
// Why this exists:
//   `tests/unit/dripTemplates.test.ts` already pins token signing and
//   the footer copy of the three onboarding drip templates, but the
//   real GET endpoint at `/api/email/drip/unsubscribe` and the two DB
//   side effects it performs (writing to `email_drip_unsubscribes`,
//   marking pending `email_drip_schedule` rows as `sent_at = now()`)
//   have no live coverage. A future refactor — token format change,
//   route move, or a tweak to the cron filter — could quietly break
//   the link in the next batch of mails without anyone noticing until
//   recipients complained.
//
// What this asserts:
//   1. A pending schedule row exists for the test address in
//      `email_drip_schedule`.
//   2. Hitting the signed unsubscribe URL via HTTP GET returns 200
//      with the localized success copy ("Du bist abgemeldet").
//   3. The previously-pending schedule row now has `sent_at`
//      populated, so the cron's `sent_at IS NULL` filter will skip it.
//   4. A row exists in `email_drip_unsubscribes` for the address —
//      the global suppression list the scheduler also consults.
//   5. Negative case: a tampered token returns HTTP 400 with the
//      "Abmelde-Link ungültig" error page and performs no DB writes.
//
// We drive the endpoint via Playwright's built-in `request` fixture
// (no browser page needed) because the route is a pure server handler
// and the test is much faster + less flaky without a Chromium round-
// trip. The Supabase service-role client is reused from the shape that
// `last-appointment.spec.ts` already uses, so the spec doesn't need
// any new fixture infrastructure beyond the `tests/global-setup.ts`
// that runs for the whole suite.

import { expect, test } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import {
  signUnsubscribeToken,
  buildUnsubscribeUrl,
} from "@/lib/emails/unsubscribeToken";

// Dedicated `.test` TLD address — non-routable, can't collide with
// real users. Suffix `-drip-unsub` so it doesn't collide with the
// shared `playwright-theme@glev.test` user the other specs reuse.
const TEST_EMAIL = "playwright-drip-unsub@glev.test";

function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "drip-unsubscribe spec needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Hard-delete every drip artifact for the test address. Called both
 * in `beforeEach` (to start each test from a known-empty baseline)
 * and `afterAll` (so a failed run doesn't pollute later suites).
 */
async function cleanupDripData(admin: SupabaseClient) {
  const { error: delScheduleErr } = await admin
    .from("email_drip_schedule")
    .delete()
    .eq("email", TEST_EMAIL);
  if (delScheduleErr) {
    throw new Error(
      `email_drip_schedule cleanup failed: ${delScheduleErr.message}`,
    );
  }
  const { error: delUnsubErr } = await admin
    .from("email_drip_unsubscribes")
    .delete()
    .eq("email", TEST_EMAIL);
  if (delUnsubErr) {
    throw new Error(
      `email_drip_unsubscribes cleanup failed: ${delUnsubErr.message}`,
    );
  }
}

/**
 * Insert one pending schedule row for the test address. We pick
 * `day7_insights` because the (email, email_type) unique index means
 * we'd collide with ourselves on the second test run otherwise — the
 * `cleanupDripData` helper above drops any prior row first.
 *
 * `scheduled_at` is set in the past so the row is definitely a
 * "pending" candidate the cron would otherwise pick up; the success
 * branch must mark it as `sent_at IS NOT NULL` to take it out of the
 * cron's filter.
 */
async function insertPendingScheduleRow(admin: SupabaseClient): Promise<string> {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const { data, error } = await admin
    .from("email_drip_schedule")
    .insert({
      email: TEST_EMAIL,
      first_name: "Lena",
      tier: "beta",
      email_type: "day7_insights",
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
  if (error) {
    throw new Error(`schedule read failed: ${error.message}`);
  }
  return (data?.sent_at ?? null) as string | null;
}

async function readUnsubscribeRow(
  admin: SupabaseClient,
): Promise<{ email: string; source: string } | null> {
  const { data, error } = await admin
    .from("email_drip_unsubscribes")
    .select("email,source")
    .eq("email", TEST_EMAIL)
    .maybeSingle();
  if (error) {
    throw new Error(`unsubscribe read failed: ${error.message}`);
  }
  return (data ?? null) as { email: string; source: string } | null;
}

test.describe("Drip mail unsubscribe endpoint", () => {
  let admin: SupabaseClient;

  test.beforeAll(() => {
    // The endpoint signs tokens with EMAIL_UNSUBSCRIBE_SECRET (or
    // CRON_SECRET as a fallback). The test process and the dev server
    // share the same env, so the same fallback chain applies — but
    // mirror the dripTemplates unit test and ensure *some* secret is
    // set before we try to sign anything in this suite. Without it
    // the helper throws and the negative test below would pass for
    // the wrong reason.
    if (
      !(process.env.EMAIL_UNSUBSCRIBE_SECRET ?? "").length &&
      !(process.env.CRON_SECRET ?? "").length
    ) {
      throw new Error(
        "drip-unsubscribe spec needs EMAIL_UNSUBSCRIBE_SECRET or CRON_SECRET",
      );
    }
    admin = getAdminClient();
  });

  test.beforeEach(async () => {
    await cleanupDripData(admin);
  });

  test.afterAll(async () => {
    if (admin) await cleanupDripData(admin);
  });

  test("valid token marks row sent + records unsubscribe + shows success page", async ({
    request,
    baseURL,
  }) => {
    const scheduleId = await insertPendingScheduleRow(admin);
    expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();
    expect(await readUnsubscribeRow(admin)).toBeNull();

    // Build the link the same way the drip templates do at send time.
    // `baseURL` comes from `playwright.config.ts` (default
    // http://localhost:5000), matching the dev-server origin.
    const url = buildUnsubscribeUrl(baseURL ?? "http://localhost:5000", TEST_EMAIL);

    const res = await request.get(url, {
      // The endpoint is a real GET (mail clients open it that way),
      // not a fetch under credentials. No cookies / headers required.
      maxRedirects: 0,
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/text\/html/);
    const body = await res.text();
    // Localized success copy from `successPage()` in the route file.
    expect(body).toContain("Du bist abgemeldet");
    // The address itself is interpolated into the body so the user
    // sees which address they unsubscribed.
    expect(body).toContain(TEST_EMAIL);

    // ---- DB EFFECTS -------------------------------------------------
    // The schedule row's sent_at must now be populated so the cron's
    // `sent_at IS NULL` filter skips it on the next tick. Poll
    // briefly in case the route is mid-write when we check.
    await expect.poll(
      () => readScheduleSentAt(admin, scheduleId),
      { timeout: 5_000 },
    ).not.toBeNull();

    // Global suppression list now carries the address with the
    // expected source ("link" = clicked footer URL).
    const unsub = await readUnsubscribeRow(admin);
    expect(unsub).not.toBeNull();
    expect(unsub?.email).toBe(TEST_EMAIL);
    expect(unsub?.source).toBe("link");
  });

  test("tampered token returns 400 + error page and does not mutate the DB", async ({
    request,
    baseURL,
  }) => {
    // Seed the same pending row so we can prove the route doesn't
    // touch it on the failure branch — a regression that flipped the
    // verify check (e.g. always-true) would otherwise be invisible
    // here.
    const scheduleId = await insertPendingScheduleRow(admin);
    expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();
    expect(await readUnsubscribeRow(admin)).toBeNull();

    // Take a real signature for the address and corrupt the last few
    // chars. Same length as the genuine token, so we exercise the
    // `timingSafeEqual` branch (unequal-length tokens short-circuit
    // earlier) — a regression that compared with `===` instead of
    // `timingSafeEqual` would still fail, but a regression that
    // skipped the length check entirely would only be caught here.
    const realToken = signUnsubscribeToken(TEST_EMAIL);
    const broken =
      realToken.slice(0, Math.max(0, realToken.length - 4)) + "AAAA";
    expect(broken).not.toBe(realToken);
    expect(broken.length).toBe(realToken.length);

    const params = new URLSearchParams({ email: TEST_EMAIL, token: broken });
    const url = `${baseURL ?? "http://localhost:5000"}/api/email/drip/unsubscribe?${params.toString()}`;

    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
    expect(res.headers()["content-type"] ?? "").toMatch(/text\/html/);
    const body = await res.text();
    // Localized error copy from `errorPage()` in the route file.
    expect(body).toContain("Abmelde-Link ist nicht gültig");

    // ---- NO DB MUTATION --------------------------------------------
    // Schedule row must still be pending; unsubscribe table must
    // still be empty for this address. We give it a tiny window to
    // surface any out-of-band write the failure branch might have
    // accidentally issued.
    await new Promise((r) => setTimeout(r, 250));
    expect(await readScheduleSentAt(admin, scheduleId)).toBeNull();
    expect(await readUnsubscribeRow(admin)).toBeNull();
  });
});
