// Unit tests for the Plus Stripe webhook pure-helper functions.
//
// The route itself requires live Stripe SDK + Supabase connections, so we
// test the pure mapping/classification helpers that are exported from the
// route file. These cover the same logic paths that the Pro webhook
// relies on (duplicated by design — the Plus webhook is an isolated endpoint).
//
// Testing surface:
//   - mapStripeStatus()      : Stripe status → pro_subscriptions.status
//   - mapStripeStatusToPlan(): Stripe status → profiles.plan
//   - isPlusPriceId()        : price ID guard — core of the Pro-filter fix

import { test, expect } from "@playwright/test";
import {
  mapStripeStatus,
  mapStripeStatusToPlan,
  isPlusPriceId,
} from "@/lib/stripeWebhookHelpers";

// ── mapStripeStatus ──────────────────────────────────────────────────────────

test("mapStripeStatus: trialing → 'trialing'", () => {
  expect(mapStripeStatus("trialing")).toBe("trialing");
});

test("mapStripeStatus: active → 'active'", () => {
  expect(mapStripeStatus("active")).toBe("active");
});

test("mapStripeStatus: past_due → 'past_due'", () => {
  expect(mapStripeStatus("past_due")).toBe("past_due");
});

test("mapStripeStatus: canceled (Stripe US spelling) → 'cancelled'", () => {
  expect(mapStripeStatus("canceled")).toBe("cancelled");
});

test("mapStripeStatus: incomplete_expired → 'cancelled'", () => {
  expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
});

test("mapStripeStatus: unpaid → 'cancelled'", () => {
  expect(mapStripeStatus("unpaid")).toBe("cancelled");
});

test("mapStripeStatus: incomplete → 'past_due' (transient, no access granted)", () => {
  expect(mapStripeStatus("incomplete")).toBe("past_due");
});

test("mapStripeStatus: paused → 'past_due' (unknown transient status)", () => {
  expect(mapStripeStatus("paused")).toBe("past_due");
});

test("mapStripeStatus: null → null", () => {
  expect(mapStripeStatus(null)).toBeNull();
});

test("mapStripeStatus: undefined → null", () => {
  expect(mapStripeStatus(undefined)).toBeNull();
});

test("mapStripeStatus: empty string → null", () => {
  expect(mapStripeStatus("")).toBeNull();
});

// ── mapStripeStatusToPlan ────────────────────────────────────────────────────

test("mapStripeStatusToPlan: trialing → 'pro' (Plus grants same gated features)", () => {
  expect(mapStripeStatusToPlan("trialing")).toBe("pro");
});

test("mapStripeStatusToPlan: active → 'pro'", () => {
  expect(mapStripeStatusToPlan("active")).toBe("pro");
});

test("mapStripeStatusToPlan: past_due → 'pro' (grace period — no preemptive downgrade)", () => {
  expect(mapStripeStatusToPlan("past_due")).toBe("pro");
});

test("mapStripeStatusToPlan: canceled → null (downgrade to free)", () => {
  expect(mapStripeStatusToPlan("canceled")).toBeNull();
});

test("mapStripeStatusToPlan: unpaid → null", () => {
  expect(mapStripeStatusToPlan("unpaid")).toBeNull();
});

test("mapStripeStatusToPlan: incomplete_expired → null", () => {
  expect(mapStripeStatusToPlan("incomplete_expired")).toBeNull();
});

test("mapStripeStatusToPlan: incomplete → undefined (leave profiles.plan untouched)", () => {
  expect(mapStripeStatusToPlan("incomplete")).toBeUndefined();
});

test("mapStripeStatusToPlan: null → undefined (missing status — caller falls back)", () => {
  expect(mapStripeStatusToPlan(null)).toBeUndefined();
});

test("mapStripeStatusToPlan: undefined → undefined", () => {
  expect(mapStripeStatusToPlan(undefined)).toBeUndefined();
});

// ── Plan-transition invariants ───────────────────────────────────────────────
// These encode the business rules that must NEVER regress:
//   • Active-ish statuses always grant plan access (never null)
//   • Terminal statuses always revoke plan access (never 'pro')
//   • Unknown/transient statuses leave the plan untouched (never 'pro' or null)

const ACTIVE_STATUSES = ["trialing", "active", "past_due"] as const;
const TERMINAL_STATUSES = ["canceled", "unpaid", "incomplete_expired"] as const;
const TRANSIENT_STATUSES = ["incomplete", "paused", "unknown_future_status"] as const;

for (const status of ACTIVE_STATUSES) {
  test(`mapStripeStatusToPlan invariant: ${status} always grants access ('pro')`, () => {
    expect(mapStripeStatusToPlan(status)).toBe("pro");
  });
}

for (const status of TERMINAL_STATUSES) {
  test(`mapStripeStatusToPlan invariant: ${status} always revokes access (null)`, () => {
    expect(mapStripeStatusToPlan(status)).toBeNull();
  });
}

for (const status of TRANSIENT_STATUSES) {
  test(`mapStripeStatusToPlan invariant: ${status} leaves plan untouched (undefined)`, () => {
    expect(mapStripeStatusToPlan(status)).toBeUndefined();
  });
}

// ── isPlusPriceId ─────────────────────────────────────────────────────────────
// This is the core guard that prevents the Plus webhook from sending a wrong
// "plus-cancelled" email when Stripe delivers a Pro-subscription event to it.
//
// Tests set process.env.STRIPE_PLUS_PRICE_ID / STRIPE_PLUS_PRICE_ID_US
// directly and restore them afterwards so they don't leak between tests.

const FAKE_EUR_PRICE = "price_eur_plus_test_001";
const FAKE_USD_PRICE = "price_usd_plus_test_002";
const FAKE_PRO_PRICE = "price_pro_trial_test_999";

test("isPlusPriceId: null → false (always ignored)", () => {
  expect(isPlusPriceId(null)).toBe(false);
});

test("isPlusPriceId: undefined → false (always ignored)", () => {
  expect(isPlusPriceId(undefined)).toBe(false);
});

test("isPlusPriceId: empty string → false", () => {
  expect(isPlusPriceId("")).toBe(false);
});

test("isPlusPriceId: unknown price ID → false (not a Plus price)", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_EUR_PRICE;
  try {
    expect(isPlusPriceId(FAKE_PRO_PRICE)).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("isPlusPriceId: EUR Plus price ID → true", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_EUR_PRICE;
  try {
    expect(isPlusPriceId(FAKE_EUR_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("isPlusPriceId: USD Plus price ID → true", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID_US;
  process.env.STRIPE_PLUS_PRICE_ID_US = FAKE_USD_PRICE;
  try {
    expect(isPlusPriceId(FAKE_USD_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID_US;
    else process.env.STRIPE_PLUS_PRICE_ID_US = prev;
  }
});

test("isPlusPriceId: both EUR and USD Plus prices recognised simultaneously", () => {
  const prevEur = process.env.STRIPE_PLUS_PRICE_ID;
  const prevUsd = process.env.STRIPE_PLUS_PRICE_ID_US;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_EUR_PRICE;
  process.env.STRIPE_PLUS_PRICE_ID_US = FAKE_USD_PRICE;
  try {
    expect(isPlusPriceId(FAKE_EUR_PRICE)).toBe(true);
    expect(isPlusPriceId(FAKE_USD_PRICE)).toBe(true);
    expect(isPlusPriceId(FAKE_PRO_PRICE)).toBe(false);
  } finally {
    if (prevEur === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prevEur;
    if (prevUsd === undefined) delete process.env.STRIPE_PLUS_PRICE_ID_US;
    else process.env.STRIPE_PLUS_PRICE_ID_US = prevUsd;
  }
});

test("isPlusPriceId: no env vars set → every price ID returns false (safe default)", () => {
  const prevEur = process.env.STRIPE_PLUS_PRICE_ID;
  const prevUsd = process.env.STRIPE_PLUS_PRICE_ID_US;
  delete process.env.STRIPE_PLUS_PRICE_ID;
  delete process.env.STRIPE_PLUS_PRICE_ID_US;
  try {
    expect(isPlusPriceId(FAKE_EUR_PRICE)).toBe(false);
    expect(isPlusPriceId(FAKE_USD_PRICE)).toBe(false);
    expect(isPlusPriceId(FAKE_PRO_PRICE)).toBe(false);
  } finally {
    if (prevEur !== undefined) process.env.STRIPE_PLUS_PRICE_ID = prevEur;
    if (prevUsd !== undefined) process.env.STRIPE_PLUS_PRICE_ID_US = prevUsd;
  }
});

// ── Business-rule invariants for isPlusPriceId ────────────────────────────────
// These encode the guard contract that must never regress:
//   • A recognised Plus price ID always passes through.
//   • A Pro price ID (or any other unknown price) is always blocked.
//   • Null/undefined price IDs are always blocked (no subscription object
//     available → treat as non-Plus rather than leaking a wrong email).

test("isPlusPriceId invariant: Pro-price-ID never triggers Plus cancellation mail", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_EUR_PRICE;
  try {
    // Simulates: Pro-Trial user cancels → Stripe sends subscription.deleted
    // with the Pro price ID to the Plus webhook endpoint.
    // isPlusPriceId must return false so the handler ACKs without enqueuing
    // a "plus-cancelled" email or touching profiles.subscription_status.
    expect(isPlusPriceId(FAKE_PRO_PRICE)).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});
