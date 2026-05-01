#!/usr/bin/env node
/**
 * scripts/backfill-buyer-names.mjs
 *
 * One-shot, idempotent backfill of `full_name` on `beta_reservations` and
 * `pro_subscriptions`.
 *
 * Why this exists
 * ---------------
 * Task #68 added a mandatory `full_name` Stripe Checkout custom field, and
 * the migration in `supabase/migrations/20260501_add_full_name_to_purchases.sql`
 * added a nullable `full_name text` column to both tables. Rows created
 * BEFORE that change still have `full_name = NULL`, which the new admin
 * lookup page (task #144) renders as "—". The buyer's name is, however,
 * still recoverable from the Stripe Checkout session for almost all of
 * those historic rows.
 *
 * What it does
 * ------------
 *   1. Fetches every row from `beta_reservations` and `pro_subscriptions`
 *      where `full_name IS NULL`.
 *   2. For `beta_reservations`: looks up the row's `stripe_session_id`
 *      directly (the column has been on the table since launch).
 *   3. For `pro_subscriptions` (no `stripe_session_id` column): finds the
 *      originating Checkout Session via
 *      `stripe.checkout.sessions.list({ subscription })` (most reliable),
 *      falling back to `{ customer }` for the rare row that has a customer
 *      id but no subscription id yet.
 *   4. Extracts the name using the SAME precedence the live webhook uses:
 *      (a) the `full_name` custom field the buyer typed at checkout
 *          (`session.custom_fields[].text.value`), and only if absent
 *      (b) `session.customer_details.name` (Stripe billing-details name).
 *   5. Writes the value back via the service-role client.
 *
 * Idempotent
 * ----------
 * Re-running is safe: rows with a non-null `full_name` are filtered out at
 * the query level, and we never overwrite an existing name. Rows where the
 * Stripe session can't be located, or where the session also has no name,
 * are skipped (and re-tried on the next run if data appears later).
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  STRIPE_SECRET_KEY=... \
 *     node scripts/backfill-buyer-names.mjs [--dry-run]
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
 * Mirror of `extractFullNameFromSession` from `lib/stripeCheckout.ts`,
 * inlined here so this script stays standalone (no TS / Next.js path
 * resolution needed when run via plain `node`).
 */
function extractFullNameFromSession(session) {
  const fields = session?.custom_fields ?? [];
  const field = fields.find((f) => f.key === "full_name");
  if (field) {
    const raw = field.text?.value ?? null;
    if (raw && raw.trim().length > 0) return raw.trim();
  }
  // Fallback to the billing-details name Stripe collects automatically —
  // mirrors the beta webhook's `fullName ?? customer_details?.name` chain
  // and is exactly what the support page would otherwise show as "—".
  const billing = session?.customer_details?.name;
  if (billing && billing.trim().length > 0) return billing.trim();
  return null;
}

/**
 * Find the Checkout Session that originated a pro subscription. Pro rows
 * don't store `stripe_session_id`, so we resolve it via the Stripe API.
 */
async function findProCheckoutSession(row) {
  // Prefer subscription id — every pro row that completed checkout has one,
  // and `sessions.list({ subscription })` returns the exact session that
  // created it. Limit 1 because a subscription is created by exactly one
  // checkout session.
  if (row.stripe_subscription_id) {
    try {
      const list = await stripe.checkout.sessions.list({
        subscription: row.stripe_subscription_id,
        limit: 1,
      });
      if (list.data[0]) {
        // Re-retrieve with custom_fields expanded — `list` does not
        // include them by default.
        return await stripe.checkout.sessions.retrieve(list.data[0].id);
      }
    } catch (err) {
      warn(
        `pro_subscriptions[${row.id}] — sessions.list({ subscription }) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Fallback: lookup by customer. May return multiple sessions if the
  // customer ever re-checked out — pick the most recent that has a name.
  if (row.stripe_customer_id) {
    try {
      const list = await stripe.checkout.sessions.list({
        customer: row.stripe_customer_id,
        limit: 10,
      });
      for (const s of list.data) {
        const full = await stripe.checkout.sessions.retrieve(s.id);
        if (extractFullNameFromSession(full)) return full;
      }
      // Even without a name, return the newest so the caller can record
      // a "skipped: no name on session" without retrying forever.
      if (list.data[0]) {
        return await stripe.checkout.sessions.retrieve(list.data[0].id);
      }
    } catch (err) {
      warn(
        `pro_subscriptions[${row.id}] — sessions.list({ customer }) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return null;
}

async function fetchBetaSession(sessionId, rowId) {
  try {
    return await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    warn(
      `beta_reservations[${rowId}] — sessions.retrieve(${sessionId}) failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

async function backfillTable({ table, rows, resolveSession }) {
  let filled = 0;
  let skippedNoSession = 0;
  let skippedNoName = 0;
  let alreadyFilled = 0;
  let failed = 0;

  for (const row of rows) {
    const session = await resolveSession(row);
    if (!session) {
      skippedNoSession += 1;
      continue;
    }
    const name = extractFullNameFromSession(session);
    if (!name) {
      skippedNoName += 1;
      info(
        `${table}[${row.id}] — no name on session ${session.id} (skipped)`,
      );
      continue;
    }

    if (DRY_RUN) {
      ok(
        `${table}[${row.id}] (${row.email}) ← "${name}" (DRY RUN, not written)`,
      );
      filled += 1;
      continue;
    }

    // Re-check `full_name IS NULL` in the WHERE clause so a concurrent
    // webhook write isn't clobbered by this backfill.
    const { data, error } = await supabase
      .from(table)
      .update({ full_name: name })
      .eq("id", row.id)
      .is("full_name", null)
      .select("id");
    if (error) {
      failed += 1;
      warn(
        `${table}[${row.id}] — update failed: ${error.code ?? ""} ${error.message}`,
      );
      continue;
    }
    if (!data || data.length === 0) {
      // Someone else (the webhook) filled it between our SELECT and UPDATE.
      // Tracked separately from `skippedNoName` so the summary is accurate.
      alreadyFilled += 1;
      info(`${table}[${row.id}] — already filled by another writer (skipped)`);
      continue;
    }
    filled += 1;
    ok(`${table}[${row.id}] (${row.email}) ← "${name}"`);
  }

  return { filled, skippedNoSession, skippedNoName, alreadyFilled, failed };
}

/**
 * Page through `select … is('full_name', null)` because Supabase's PostgREST
 * applies a server-side row cap (default 1000) that would silently truncate a
 * large backfill set. Loops until a short page or empty page is returned so
 * a single run is guaranteed to see every qualifying row.
 */
const PAGE_SIZE = 500;

async function fetchAllNullNameRows(table, columns) {
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is("full_name", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) fail(`${table} select failed at offset ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Sanity-check completeness at the end of the run: report how many
 * `full_name IS NULL` rows remain so the operator can tell at a glance
 * whether the backfill is "done" or whether more rows surfaced (eg. via
 * concurrent webhook activity) and a re-run is warranted.
 */
async function countRemainingNulls(table) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .is("full_name", null);
  if (error) {
    warn(`${table} remaining-null count failed: ${error.message}`);
    return null;
  }
  return count ?? 0;
}

async function main() {
  info(
    `starting backfill${DRY_RUN ? " (DRY RUN — no writes)" : ""} on ${SUPABASE_URL}`,
  );

  // beta_reservations: needs stripe_session_id to look up the session.
  // Rows without one are unrecoverable from Stripe and are reported as such.
  const betaRows = await fetchAllNullNameRows(
    "beta_reservations",
    "id, email, full_name, stripe_session_id, stripe_customer_id",
  );

  const betaWithSession = betaRows.filter((r) => !!r.stripe_session_id);
  const betaWithoutSession = betaRows.length - betaWithSession.length;
  info(
    `beta_reservations: ${betaRows.length} rows with full_name IS NULL ` +
      `(${betaWithSession.length} have stripe_session_id, ` +
      `${betaWithoutSession} unrecoverable)`,
  );

  const betaResult = await backfillTable({
    table: "beta_reservations",
    rows: betaWithSession,
    resolveSession: (row) => fetchBetaSession(row.stripe_session_id, row.id),
  });

  // pro_subscriptions: no stripe_session_id column, so we resolve via the
  // Stripe API using stripe_subscription_id (preferred) / stripe_customer_id.
  const proRows = await fetchAllNullNameRows(
    "pro_subscriptions",
    "id, email, full_name, stripe_subscription_id, stripe_customer_id",
  );

  const proWithStripe = proRows.filter(
    (r) => r.stripe_subscription_id || r.stripe_customer_id,
  );
  const proWithoutStripe = proRows.length - proWithStripe.length;
  info(
    `pro_subscriptions: ${proRows.length} rows with full_name IS NULL ` +
      `(${proWithStripe.length} have a Stripe subscription/customer id, ` +
      `${proWithoutStripe} unrecoverable)`,
  );

  const proResult = await backfillTable({
    table: "pro_subscriptions",
    rows: proWithStripe,
    resolveSession: findProCheckoutSession,
  });

  // Re-count `full_name IS NULL` after the run so the operator can see at a
  // glance whether the backfill caught everything or whether more rows
  // surfaced (eg. via concurrent webhook activity) and a re-run is warranted.
  const betaRemaining = DRY_RUN
    ? betaRows.length
    : await countRemainingNulls("beta_reservations");
  const proRemaining = DRY_RUN
    ? proRows.length
    : await countRemainingNulls("pro_subscriptions");

  console.log("");
  ok("── summary ──");
  console.log(
    `beta_reservations: filled=${betaResult.filled} ` +
      `skipped(no session)=${betaResult.skippedNoSession + betaWithoutSession} ` +
      `skipped(no name)=${betaResult.skippedNoName} ` +
      `skipped(already filled)=${betaResult.alreadyFilled} ` +
      `failed=${betaResult.failed} ` +
      `remaining-null=${betaRemaining ?? "?"}`,
  );
  console.log(
    `pro_subscriptions: filled=${proResult.filled} ` +
      `skipped(no session)=${proResult.skippedNoSession + proWithoutStripe} ` +
      `skipped(no name)=${proResult.skippedNoName} ` +
      `skipped(already filled)=${proResult.alreadyFilled} ` +
      `failed=${proResult.failed} ` +
      `remaining-null=${proRemaining ?? "?"}`,
  );
  const totalSkipped =
    betaResult.skippedNoSession +
    betaResult.skippedNoName +
    betaResult.alreadyFilled +
    proResult.skippedNoSession +
    proResult.skippedNoName +
    proResult.alreadyFilled +
    betaWithoutSession +
    proWithoutStripe;
  console.log(
    `totals: filled=${betaResult.filled + proResult.filled} ` +
      `skipped=${totalSkipped} ` +
      `failed=${betaResult.failed + proResult.failed}` +
      (DRY_RUN ? "  (DRY RUN — nothing was written)" : ""),
  );

  if (betaResult.failed + proResult.failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\x1b[31m✖ fatal:\x1b[0m", e);
  process.exit(1);
});
