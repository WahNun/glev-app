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

import { test, expect } from "@playwright/test";
import {
  mapStripeStatus,
  mapStripeStatusToPlan,
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
