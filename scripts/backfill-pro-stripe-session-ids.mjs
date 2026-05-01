#!/usr/bin/env node
/**
 * scripts/backfill-pro-stripe-session-ids.mjs
 *
 * One-shot, idempotent backfill of `stripe_session_id` on `pro_subscriptions`.
 *
 * Why this exists
 * ---------------
 * Task #157 added a `stripe_session_id text` column to `pro_subscriptions`
 * (mirror of the long-standing column on `beta_reservations`) and made the
 * live Pro webhook stamp it on every new Checkout. Rows that converted
 * BEFORE that change still have `stripe_session_id = NULL`, so support
 * tooling and the buyer-name backfill have to round-trip through
 * `stripe.checkout.sessions.list({ subscription })` for those historic rows.
 * This script closes the gap so every Pro row carries the same shape of
 * Stripe identifiers as Beta rows do.
 *
 * What it does
 * ------------
 *   1. Pages through `pro_subscriptions` selecting every row where
 *      `stripe_session_id IS NULL` and `stripe_subscription_id IS NOT NULL`.
 *      Rows without a subscription id (incomplete checkouts, manual inserts)
 *      are reported as unrecoverable rather than guessed at.
 *   2. For each row, calls `stripe.checkout.sessions.list({ subscription,
 *      limit: 1 })` — a subscription is created by exactly one Checkout
 *      session, so this returns the originating session.
 *   3. Writes the session id back via the service-role client, with
 *      `is('stripe_session_id', null)` in the WHERE clause so a concurrent
 *      webhook write isn't clobbered.
 *
 * Idempotent
 * ----------
 * Re-running is safe: rows with a non-null `stripe_session_id` are filtered
 * out at the SELECT, and the UPDATE itself re-asserts the NULL guard. Rows
 * where Stripe can't locate a session for the subscription are skipped (and
 * re-tried on the next run if data appears later).
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  STRIPE_SECRET_KEY=... \
 *     node scripts/backfill-pro-stripe-session-ids.mjs [--dry-run]
 *
 *   --dry-run   Print what WOULD be written, without issuing UPDATEs.
 */

import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const DRY_RUN = process.argv.includes("--dry-run");

function fail(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
}

function info(msg) {
  console.log(`\x1b[36mℹ ${msg}\x1b[0m`);
}

function ok(msg) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function warn(msg) {
  console.warn(`\x1b[33m! ${msg}\x1b[0m`);
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
}
if (!STRIPE_SECRET_KEY) {
  fail("STRIPE_SECRET_KEY must be set.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stripe = new Stripe(STRIPE_SECRET_KEY);

/**
 * Resolve the Checkout Session that originated a Pro subscription.
 *
 * `sessions.list({ subscription })` returns the exact session that created
 * the subscription — a subscription has exactly one originating session, so
 * `limit: 1` is always correct here. (We deliberately do NOT fall back to
 * `{ customer }` like the buyer-name backfill does: that backfill needs a
 * session with a name on it, but here we want THE session that created the
 * subscription, and a customer's later Billing-Portal sessions would be the
 * wrong row.)
 */
async function findCheckoutSessionId(row) {
  try {
    const list = await stripe.checkout.sessions.list({
      subscription: row.stripe_subscription_id,
      limit: 1,
    });
    return list.data[0]?.id ?? null;
  } catch (err) {
    warn(
      `pro_subscriptions[${row.id}] — sessions.list({ subscription: ${row.stripe_subscription_id} }) failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Page through `select … is('stripe_session_id', null)` because Supabase's
 * PostgREST applies a server-side row cap (default 1000) that would silently
 * truncate a large backfill set. Loops until a short or empty page is
 * returned so a single run sees every qualifying row.
 */
const PAGE_SIZE = 500;

async function fetchAllNullSessionRows() {
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("pro_subscriptions")
      .select("id, email, stripe_session_id, stripe_subscription_id")
      .is("stripe_session_id", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      fail(`pro_subscriptions select failed at offset ${from}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Sanity-check completeness at the end of the run: report how many
 * `stripe_session_id IS NULL` rows remain so the operator can tell at a
 * glance whether the backfill is "done" or whether more rows surfaced
 * (eg. via concurrent webhook activity) and a re-run is warranted.
 */
async function countRemainingNulls() {
  const { count, error } = await supabase
    .from("pro_subscriptions")
    .select("id", { count: "exact", head: true })
    .is("stripe_session_id", null);
  if (error) {
    warn(`pro_subscriptions remaining-null count failed: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

async function main() {
  info(
    `starting pro_subscriptions stripe_session_id backfill${
      DRY_RUN ? " (DRY RUN — no writes)" : ""
    } on ${SUPABASE_URL}`,
  );

  const allRows = await fetchAllNullSessionRows();
  const recoverable = allRows.filter((r) => !!r.stripe_subscription_id);
  const unrecoverable = allRows.length - recoverable.length;

  info(
    `pro_subscriptions: ${allRows.length} rows with stripe_session_id IS NULL ` +
      `(${recoverable.length} have stripe_subscription_id, ` +
      `${unrecoverable} unrecoverable — no subscription id)`,
  );

  let filled = 0;
  let skippedNoSession = 0;
  let alreadyFilled = 0;
  let failed = 0;

  for (const row of recoverable) {
    const sessionId = await findCheckoutSessionId(row);
    if (!sessionId) {
      skippedNoSession += 1;
      info(
        `pro_subscriptions[${row.id}] (${row.email ?? "—"}) — ` +
          `no session found for subscription ${row.stripe_subscription_id} (skipped)`,
      );
      continue;
    }

    if (DRY_RUN) {
      ok(
        `pro_subscriptions[${row.id}] (${row.email ?? "—"}) ← ${sessionId} (DRY RUN, not written)`,
      );
      filled += 1;
      continue;
    }

    // Re-assert `stripe_session_id IS NULL` in the WHERE clause so a
    // concurrent webhook write isn't clobbered by this backfill.
    const { data, error } = await supabase
      .from("pro_subscriptions")
      .update({ stripe_session_id: sessionId })
      .eq("id", row.id)
      .is("stripe_session_id", null)
      .select("id");
    if (error) {
      failed += 1;
      warn(
        `pro_subscriptions[${row.id}] — update failed: ${error.code ?? ""} ${error.message}`,
      );
      continue;
    }
    if (!data || data.length === 0) {
      // Someone else (the webhook) filled it between our SELECT and UPDATE.
      alreadyFilled += 1;
      info(
        `pro_subscriptions[${row.id}] — already filled by another writer (skipped)`,
      );
      continue;
    }
    filled += 1;
    ok(`pro_subscriptions[${row.id}] (${row.email ?? "—"}) ← ${sessionId}`);
  }

  const remaining = DRY_RUN ? allRows.length : await countRemainingNulls();

  console.log("");
  ok("── summary ──");
  console.log(
    `pro_subscriptions: filled=${filled} ` +
      `skipped(no session)=${skippedNoSession + unrecoverable} ` +
      `skipped(already filled)=${alreadyFilled} ` +
      `failed=${failed} ` +
      `remaining-null=${remaining ?? "?"}` +
      (DRY_RUN ? "  (DRY RUN — nothing was written)" : ""),
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\x1b[31m✖ fatal:\x1b[0m", e);
  process.exit(1);
});
