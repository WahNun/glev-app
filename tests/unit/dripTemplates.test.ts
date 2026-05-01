// Unit coverage for the Tag-7 / Tag-14 / Tag-30 drip-email templates
// in `lib/emails/drip-templates.ts`.
//
// Why this exists:
//   The three drip templates render once a day in a cron job that has
//   no live developer eyeballs on it (no preview, no dashboard). A
//   typo in the personalization fallback ("Hallo undefined") or a
//   broken Trustpilot link would only surface days later, after the
//   mail already went out to a real buyer. These tests pin the most
//   regression-prone bits — the greeting fallback, the personalised
//   subject, and that the disclaimer footer is always present.

import { test, expect } from "@playwright/test";

import {
  day7InsightsEmail,
  day14FeedbackEmail,
  day30TrustpilotEmail,
  renderDripEmail,
  type DripEmailType,
} from "@/lib/emails/drip-templates";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from "@/lib/emails/unsubscribeToken";

// The unsubscribe link builder needs a signing secret; without one the
// drip templates would throw at render time, which is exactly why these
// tests exist (mail must always carry an opt-out). Use a deterministic
// test secret so the assertions don't depend on shell env.
process.env.EMAIL_UNSUBSCRIBE_SECRET =
  process.env.EMAIL_UNSUBSCRIBE_SECRET || "test-secret-min-16-chars-please";

const TEST_EMAIL = "lena@example.com";

test("day7 insights email renders with first name", () => {
  const r = day7InsightsEmail("Lena", TEST_EMAIL);
  expect(r.subject).toMatch(/Insights/);
  expect(r.html).toContain("Hallo Lena");
  expect(r.html).toContain("Insights ansehen");
  // Disclaimer footer must be present on every drip mail.
  expect(r.html).toMatch(/Medizinprodukt/);
  // Sender stays the canonical Glev info address.
  expect(r.from).toContain("info@glev.app");
});

test("day7 insights email falls back to neutral greeting without a name", () => {
  const r = day7InsightsEmail(null, TEST_EMAIL);
  expect(r.html).toContain("Hallo");
  // Crucially, no "Hallo null" / "Hallo undefined" leak.
  expect(r.html).not.toMatch(/Hallo (null|undefined)/);
});

test("day14 feedback email personalises the subject when a name is given", () => {
  const named = day14FeedbackEmail("Marc", TEST_EMAIL);
  expect(named.subject).toBe("Marc, wie läuft Glev für dich?");
  expect(named.html).toContain("Hallo Marc");

  const anon = day14FeedbackEmail(null, TEST_EMAIL);
  expect(anon.subject).toBe("Wie läuft Glev für dich?");
});

test("day30 trustpilot email links to trustpilot.com", () => {
  const r = day30TrustpilotEmail("Anna", TEST_EMAIL);
  expect(r.html).toMatch(/trustpilot\.com/i);
  expect(r.html).toContain("Hallo Anna");
  expect(r.subject).toMatch(/bewerten/i);
});

test("renderDripEmail dispatches to the correct template per type", () => {
  const cases: DripEmailType[] = ["day7_insights", "day14_feedback", "day30_trustpilot"];
  for (const type of cases) {
    const r = renderDripEmail(type, "Sam", TEST_EMAIL);
    expect(r.html).toContain("Hallo Sam");
    expect(r.html).toMatch(/Medizinprodukt/);
  }
});

// ---- Unsubscribe footer link ---------------------------------------------

test("every drip mail carries a signed unsubscribe link in the footer", () => {
  const cases: DripEmailType[] = ["day7_insights", "day14_feedback", "day30_trustpilot"];
  for (const type of cases) {
    const r = renderDripEmail(type, "Sam", TEST_EMAIL);
    expect(r.html).toMatch(/Aus dieser Onboarding-Serie abmelden/);
    expect(r.html).toMatch(/\/api\/email\/drip\/unsubscribe\?email=/);
    // Token must be present (non-empty value after token=)
    expect(r.html).toMatch(/token=[A-Za-z0-9_-]+/);
  }
});

test("unsubscribe token is deterministic per address and verifies round-trip", () => {
  const t1 = signUnsubscribeToken("user@example.com");
  const t2 = signUnsubscribeToken("USER@example.com"); // case-insensitive
  expect(t1).toBe(t2);
  expect(verifyUnsubscribeToken("user@example.com", t1)).toBe(true);
  // Tampered token rejected.
  expect(verifyUnsubscribeToken("user@example.com", t1 + "x")).toBe(false);
  // Wrong address rejected.
  expect(verifyUnsubscribeToken("attacker@example.com", t1)).toBe(false);
  // Empty inputs rejected.
  expect(verifyUnsubscribeToken("", t1)).toBe(false);
  expect(verifyUnsubscribeToken("user@example.com", "")).toBe(false);
});

test("buildUnsubscribeUrl produces a parseable URL with normalised email", () => {
  const url = buildUnsubscribeUrl("https://glev.app", "  Mixed@Example.com  ");
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/api/email/drip/unsubscribe");
  expect(parsed.searchParams.get("email")).toBe("mixed@example.com");
  expect(parsed.searchParams.get("token")).toBeTruthy();
});
