#!/usr/bin/env node
/**
 * scripts/backfill-stripe-customer-names.mjs
 *
 * One-shot, idempotent backfill of `customer.name` on the **Stripe Customer
 * object** for every historic Beta / Pro buyer.
 *
 * Why this exists
 * ---------------
 * The Stripe Checkout `full_name` custom field (task #68) lands on the
 * Checkout *Session*, not on the Customer. Until task #173 wired the
 * webhooks to mirror the value onto the Customer via `customers.update`,
 * every Customer row in the Stripe Dashboard showed up nameless even
 * though we collected the name. Lucas needs the names visible in the
 * dashboard / Stripe mobile app to stay in close contact with early
 * testers.
 *
 * Sister script to `backfill-buyer-names.mjs`, which fills the local
 * `full_name` DB column. This one walks the same rows and pushes the
 * value out to Stripe.
 *
 * What it does
 * ------------
 *   1. Selects every row from `beta_reservations` and `pro_subscriptions`
 *      where `full_name IS NOT NULL` AND `stripe_customer_id IS NOT NULL`.
 *   2. For each row: retrieves the Stripe Customer.
 *      - If `customer.name` is already set (non-empty), skips it — we
 *        never overwrite a name a human/Stripe already has on file.
 *      - If empty, calls `stripe.customers.update(id, { name })`.
 *   3. Reports a summary. Re-runnable safely.
 *
 * Idempotent
 * ----------
 * Re-running is safe: rows where the Stripe Customer already has a name
 * are skipped at the API level (one read before each write). Rows whose
 * Stripe Customer was deleted out from under us are reported and skipped.
 *
 * Usage
 * -----
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  STRIPE_SECRET_KEY=... \
 *     node scripts/backfill-stripe-customer-names.mjs [--dry-run]
 *
 *   --dry-run   Print what WOULD be written to Stripe, without issuing
 *               any `customers.update` calls.
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
 * Page through `select` because Supabase's PostgREST applies a server-side
 * row cap (default 1000) that would silently truncate a large backfill set.
 * Loops until a short page or empty page is returned so a single run is
 * guaranteed to see every qualifying row.
 */
const PAGE_SIZE = 500;

async function fetchEligibleRows(table) {
  const all = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select("id, email, full_name, stripe_customer_id")
      .not("full_name", "is", null)
      .not("stripe_customer_id", "is", null)
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

async function backfillTable(table, rows) {
  let updated = 0;
  let alreadyNamed = 0;
  let missingCustomer = 0;
  let failed = 0;

  for (const row of rows) {
    const name = (row.full_name ?? "").trim();
    if (!name) continue; // defensive — shouldn't happen given the WHERE.

    let customer;
    try {
      customer = await stripe.customers.retrieve(row.stripe_customer_id);
    } catch (err) {
      missingCustomer += 1;
      warn(
        `${table}[${row.id}] (${row.email}) — customers.retrieve(${row.stripe_customer_id}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    if (customer.deleted) {
      missingCustomer += 1;
      info(
        `${table}[${row.id}] (${row.email}) — customer ${row.stripe_customer_id} is deleted (skipped)`,
      );
      continue;
    }

    const existing = (customer.name ?? "").trim();
    if (existing) {
      alreadyNamed += 1;
      continue;
    }

    if (DRY_RUN) {
      ok(
        `${table}[${row.id}] (${row.email}) ${row.stripe_customer_id} ← "${name}" (DRY RUN, not written)`,
      );
      updated += 1;
      continue;
    }

    try {
      await stripe.customers.update(row.stripe_customer_id, { name });
      updated += 1;
      ok(`${table}[${row.id}] (${row.email}) ${row.stripe_customer_id} ← "${name}"`);
    } catch (err) {
      failed += 1;
      warn(
        `${table}[${row.id}] — customers.update failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { updated, alreadyNamed, missingCustomer, failed };
}

async function main() {
  info(
    `starting Stripe customer-name backfill${DRY_RUN ? " (DRY RUN — no writes)" : ""} on ${SUPABASE_URL}`,
  );

  const betaRows = await fetchEligibleRows("beta_reservations");
  info(
    `beta_reservations: ${betaRows.length} rows with full_name + stripe_customer_id`,
  );
  const betaResult = await backfillTable("beta_reservations", betaRows);

  const proRows = await fetchEligibleRows("pro_subscriptions");
  info(
    `pro_subscriptions: ${proRows.length} rows with full_name + stripe_customer_id`,
  );
  const proResult = await backfillTable("pro_subscriptions", proRows);

  console.log("");
  ok("── summary ──");
  console.log(
    `beta_reservations: updated=${betaResult.updated} ` +
      `already-named=${betaResult.alreadyNamed} ` +
      `missing-customer=${betaResult.missingCustomer} ` +
      `failed=${betaResult.failed}`,
  );
  console.log(
    `pro_subscriptions: updated=${proResult.updated} ` +
      `already-named=${proResult.alreadyNamed} ` +
      `missing-customer=${proResult.missingCustomer} ` +
      `failed=${proResult.failed}`,
  );
  console.log(
    `totals: updated=${betaResult.updated + proResult.updated} ` +
      `already-named=${betaResult.alreadyNamed + proResult.alreadyNamed} ` +
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
