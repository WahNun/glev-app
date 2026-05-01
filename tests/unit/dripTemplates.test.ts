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

test("day7 insights email renders with first name", () => {
  const r = day7InsightsEmail("Lena");
  expect(r.subject).toMatch(/Insights/);
  expect(r.html).toContain("Hallo Lena");
  expect(r.html).toContain("Insights ansehen");
  // Disclaimer footer must be present on every drip mail.
  expect(r.html).toMatch(/Medizinprodukt/);
  // Sender stays the canonical Glev info address.
  expect(r.from).toContain("info@glev.app");
});

test("day7 insights email falls back to neutral greeting without a name", () => {
  const r = day7InsightsEmail(null);
  expect(r.html).toContain("Hallo");
  // Crucially, no "Hallo null" / "Hallo undefined" leak.
  expect(r.html).not.toMatch(/Hallo (null|undefined)/);
});

test("day14 feedback email personalises the subject when a name is given", () => {
  const named = day14FeedbackEmail("Marc");
  expect(named.subject).toBe("Marc, wie läuft Glev für dich?");
  expect(named.html).toContain("Hallo Marc");

  const anon = day14FeedbackEmail(null);
  expect(anon.subject).toBe("Wie läuft Glev für dich?");
});

test("day30 trustpilot email links to trustpilot.com", () => {
  const r = day30TrustpilotEmail("Anna");
  expect(r.html).toMatch(/trustpilot\.com/i);
  expect(r.html).toContain("Hallo Anna");
  expect(r.subject).toMatch(/bewerten/i);
});

test("renderDripEmail dispatches to the correct template per type", () => {
  const cases: DripEmailType[] = ["day7_insights", "day14_feedback", "day30_trustpilot"];
  for (const type of cases) {
    const r = renderDripEmail(type, "Sam");
    expect(r.html).toContain("Hallo Sam");
    expect(r.html).toMatch(/Medizinprodukt/);
  }
});
