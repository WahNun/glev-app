// Unit tests for Pro webhook pure-helper functions and the isPlusPriceId guard
// used inside /api/pro/webhook/route.ts.
//
// The route itself requires live Stripe SDK + Supabase connections, so we
// test the pure mapping/classification helpers exported from stripeWebhookHelpers
// and the isProPriceId helper that mirrors isPlusPriceId for the Pro side.
//
// Testing surface:
//   - isProPriceId()   : Pro-price guard — blocks non-Pro prices in Pro webhook
//   - isPlusPriceId()  : Plus-price guard — blocks Plus prices in Pro webhook
//   - Symmetry invariants: a price is never simultaneously Pro AND Plus

import { test, expect } from "@playwright/test";
import {
  isPlusPriceId,
  isProPriceId,
} from "@/lib/stripeWebhookHelpers";

const FAKE_PRO_EUR_PRICE  = "price_eur_pro_test_001";
const FAKE_PRO_USD_PRICE  = "price_usd_pro_test_002";
const FAKE_PLUS_EUR_PRICE = "price_eur_plus_test_003";
const FAKE_PLUS_USD_PRICE = "price_usd_plus_test_004";
const FAKE_OTHER_PRICE    = "price_unknown_test_999";

// ── isProPriceId — null/undefined/empty ──────────────────────────────────────

test("isProPriceId: null → false (always ignored)", () => {
  expect(isProPriceId(null)).toBe(false);
});

test("isProPriceId: undefined → false (always ignored)", () => {
  expect(isProPriceId(undefined)).toBe(false);
});

test("isProPriceId: empty string → false", () => {
  expect(isProPriceId("")).toBe(false);
});

// ── isProPriceId — env-var driven recognition ────────────────────────────────

test("isProPriceId: unknown price ID → false (not a Pro price)", () => {
  const prev = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = FAKE_PRO_EUR_PRICE;
  try {
    expect(isProPriceId(FAKE_OTHER_PRICE)).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = prev;
  }
});

test("isProPriceId: EUR Pro price ID → true", () => {
  const prev = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = FAKE_PRO_EUR_PRICE;
  try {
    expect(isProPriceId(FAKE_PRO_EUR_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = prev;
  }
});

test("isProPriceId: USD Pro price ID → true", () => {
  const prev = process.env.STRIPE_PRO_PRICE_ID_US;
  process.env.STRIPE_PRO_PRICE_ID_US = FAKE_PRO_USD_PRICE;
  try {
    expect(isProPriceId(FAKE_PRO_USD_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PRO_PRICE_ID_US;
    else process.env.STRIPE_PRO_PRICE_ID_US = prev;
  }
});

test("isProPriceId: both EUR and USD Pro prices recognised simultaneously", () => {
  const prevEur = process.env.STRIPE_PRO_PRICE_ID;
  const prevUsd = process.env.STRIPE_PRO_PRICE_ID_US;
  process.env.STRIPE_PRO_PRICE_ID    = FAKE_PRO_EUR_PRICE;
  process.env.STRIPE_PRO_PRICE_ID_US = FAKE_PRO_USD_PRICE;
  try {
    expect(isProPriceId(FAKE_PRO_EUR_PRICE)).toBe(true);
    expect(isProPriceId(FAKE_PRO_USD_PRICE)).toBe(true);
    expect(isProPriceId(FAKE_PLUS_EUR_PRICE)).toBe(false);
  } finally {
    if (prevEur === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = prevEur;
    if (prevUsd === undefined) delete process.env.STRIPE_PRO_PRICE_ID_US;
    else process.env.STRIPE_PRO_PRICE_ID_US = prevUsd;
  }
});

test("isProPriceId: no env vars set → every price ID returns false (safe default)", () => {
  const prevEur = process.env.STRIPE_PRO_PRICE_ID;
  const prevUsd = process.env.STRIPE_PRO_PRICE_ID_US;
  delete process.env.STRIPE_PRO_PRICE_ID;
  delete process.env.STRIPE_PRO_PRICE_ID_US;
  try {
    expect(isProPriceId(FAKE_PRO_EUR_PRICE)).toBe(false);
    expect(isProPriceId(FAKE_PRO_USD_PRICE)).toBe(false);
    expect(isProPriceId(FAKE_PLUS_EUR_PRICE)).toBe(false);
  } finally {
    if (prevEur !== undefined) process.env.STRIPE_PRO_PRICE_ID    = prevEur;
    if (prevUsd !== undefined) process.env.STRIPE_PRO_PRICE_ID_US = prevUsd;
  }
});

// ── isPlusPriceId guard in the Pro webhook context ───────────────────────────
// This is the primary guard that prevents the Pro webhook from processing
// Plus-subscription events (subscription.updated / subscription.deleted).

test("isPlusPriceId: null → false (no price available → not Plus)", () => {
  expect(isPlusPriceId(null)).toBe(false);
});

test("isPlusPriceId: undefined → false", () => {
  expect(isPlusPriceId(undefined)).toBe(false);
});

test("isPlusPriceId: Pro price ID → false (must not be blocked by Plus guard)", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  try {
    expect(isPlusPriceId(FAKE_PRO_EUR_PRICE)).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("isPlusPriceId: Plus EUR price → true (Pro webhook must skip this event)", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  try {
    expect(isPlusPriceId(FAKE_PLUS_EUR_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("isPlusPriceId: Plus USD price → true (Pro webhook must skip this event)", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID_US;
  process.env.STRIPE_PLUS_PRICE_ID_US = FAKE_PLUS_USD_PRICE;
  try {
    expect(isPlusPriceId(FAKE_PLUS_USD_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID_US;
    else process.env.STRIPE_PLUS_PRICE_ID_US = prev;
  }
});

// ── Symmetry invariants ──────────────────────────────────────────────────────
// A price ID must never be classified as both Pro AND Plus simultaneously.
// Violating this would create an ambiguous dispatch that silently drops events.

test("symmetry: Pro EUR price is not a Plus price", () => {
  const prevPlus = process.env.STRIPE_PLUS_PRICE_ID;
  const prevPro  = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  process.env.STRIPE_PRO_PRICE_ID  = FAKE_PRO_EUR_PRICE;
  try {
    expect(isProPriceId(FAKE_PRO_EUR_PRICE)).toBe(true);
    expect(isPlusPriceId(FAKE_PRO_EUR_PRICE)).toBe(false);
  } finally {
    if (prevPlus === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prevPlus;
    if (prevPro === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = prevPro;
  }
});

test("symmetry: Plus EUR price is not a Pro price", () => {
  const prevPlus = process.env.STRIPE_PLUS_PRICE_ID;
  const prevPro  = process.env.STRIPE_PRO_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  process.env.STRIPE_PRO_PRICE_ID  = FAKE_PRO_EUR_PRICE;
  try {
    expect(isPlusPriceId(FAKE_PLUS_EUR_PRICE)).toBe(true);
    expect(isProPriceId(FAKE_PLUS_EUR_PRICE)).toBe(false);
  } finally {
    if (prevPlus === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prevPlus;
    if (prevPro === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = prevPro;
  }
});

// ── Business-rule invariants ─────────────────────────────────────────────────
// These encode the guard contract that must never regress:
//   • A Plus price ID always triggers the Pro webhook guard (isPlusPriceId → true).
//   • A Pro price ID never triggers the Plus guard on the Pro webhook side.
//   • Null/undefined are always non-Plus (guard does not fire on missing data).

test("guard invariant: Plus cancellation must be blocked by Pro webhook guard", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  try {
    // Simulates: Plus user cancels → Stripe sends subscription.deleted with
    // Plus price ID to the Pro webhook endpoint.
    // isPlusPriceId must return true so the handler ACKs without touching
    // pro_subscriptions or sending a 'pro-cancelled' email.
    expect(isPlusPriceId(FAKE_PLUS_EUR_PRICE)).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("guard invariant: Pro cancellation must NOT be blocked by Pro webhook guard", () => {
  const prev = process.env.STRIPE_PLUS_PRICE_ID;
  process.env.STRIPE_PLUS_PRICE_ID = FAKE_PLUS_EUR_PRICE;
  try {
    // Simulates: Pro user cancels → Stripe sends subscription.deleted with
    // Pro price ID to the Pro webhook endpoint.
    // isPlusPriceId must return false so the handler processes the event normally.
    expect(isPlusPriceId(FAKE_PRO_EUR_PRICE)).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PLUS_PRICE_ID;
    else process.env.STRIPE_PLUS_PRICE_ID = prev;
  }
});

test("guard invariant: null price ID is never considered Plus (guard does not block unknown)", () => {
  expect(isPlusPriceId(null)).toBe(false);
});
