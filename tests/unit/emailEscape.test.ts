// tests/unit/emailEscape.test.ts
//
// Unit coverage for HTML-escaping of buyer names in email templates.
//
// ─── Coverage ────────────────────────────────────────────────────────────────
//   1. escapeHtml helper — all 5 special characters + null passthrough
//   2. betaWelcomeHtml  — malicious name doesn't inject raw HTML (de + en)
//   3. proWelcomeHtml   — same for the Pro welcome template
//   4. day7InsightsEmail  — drip greeting escapes the name
//   5. day14FeedbackEmail — drip greeting escapes the name
//   6. day30TrustpilotEmail — drip greeting escapes the name
//   7. Normal names still appear readable (no double-encoding)

import { test, expect } from "@playwright/test";

// Pull helpers directly — no network, no Resend, no env needed
import { escapeHtml } from "../../lib/emails/escape";
import { betaWelcomeHtml } from "../../lib/emails/beta-welcome";
import { proWelcomeHtml } from "../../lib/emails/pro-welcome";
import {
  day7InsightsEmail,
  day14FeedbackEmail,
  day30TrustpilotEmail,
} from "../../lib/emails/drip-templates";

// ── escapeHtml unit ──────────────────────────────────────────────────────────

test("escapeHtml: null passes through as null", () => {
  expect(escapeHtml(null)).toBeNull();
});

test("escapeHtml: escapes < and >", () => {
  expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
});

test("escapeHtml: escapes &", () => {
  expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
});

test("escapeHtml: escapes double-quote", () => {
  expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
});

test("escapeHtml: escapes single-quote", () => {
  expect(escapeHtml("it's")).toBe("it&#39;s");
});

test("escapeHtml: clean string is returned unchanged", () => {
  expect(escapeHtml("Anna")).toBe("Anna");
});

test("escapeHtml: all five characters at once", () => {
  expect(escapeHtml(`<>"'&`)).toBe("&lt;&gt;&quot;&#39;&amp;");
});

// ── betaWelcomeHtml ──────────────────────────────────────────────────────────

const EVIL = "<script>alert(1)</script>";

test("betaWelcomeHtml de: malicious name renders as escaped text, no raw tag", () => {
  const html = betaWelcomeHtml(EVIL, null, null, "de");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("betaWelcomeHtml en: malicious name renders as escaped text, no raw tag", () => {
  const html = betaWelcomeHtml(EVIL, null, null, "en");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("betaWelcomeHtml de: ampersand in single-token name is escaped", () => {
  // firstNameFrom splits on whitespace — use a single token that contains &
  const html = betaWelcomeHtml("Tom&Jerry", null, null, "de");
  expect(html).not.toContain("Tom&Jerry");
  expect(html).toContain("Tom&amp;Jerry");
});

test("betaWelcomeHtml: normal first name is readable (no over-encoding)", () => {
  const html = betaWelcomeHtml("Anna Müller", null, null, "de");
  expect(html).toContain("Hallo Anna");
});

test("betaWelcomeHtml: null name falls back to neutral greeting", () => {
  const html = betaWelcomeHtml(null, null, null, "de");
  expect(html).toContain("Hallo 👋");
});

// ── proWelcomeHtml ───────────────────────────────────────────────────────────

test("proWelcomeHtml de: malicious name is escaped", () => {
  const html = proWelcomeHtml(EVIL, null, null, null, "de");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("proWelcomeHtml en: malicious name is escaped", () => {
  const html = proWelcomeHtml(EVIL, null, null, null, "en");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("proWelcomeHtml: angle brackets in single-token name don't break layout", () => {
  // firstNameFrom splits on whitespace — use a single token that contains <>
  const html = proWelcomeHtml("<Max>", null, null, null, "de");
  expect(html).not.toContain("<Max>");
  expect(html).toContain("&lt;Max&gt;");
});

test("proWelcomeHtml: normal first name is readable", () => {
  const html = proWelcomeHtml("Max Müller", null, null, null, "de");
  expect(html).toContain("Hallo Max");
});

// ── drip templates ───────────────────────────────────────────────────────────

const DUMMY_EMAIL = "test@example.com";

test("day7InsightsEmail: malicious name is escaped in greeting", () => {
  const { html } = day7InsightsEmail(EVIL, DUMMY_EMAIL, "de");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("day7InsightsEmail en: malicious name is escaped in greeting", () => {
  const { html } = day7InsightsEmail(EVIL, DUMMY_EMAIL, "en");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("day7InsightsEmail: normal name is readable", () => {
  const { html } = day7InsightsEmail("Anna", DUMMY_EMAIL, "de");
  expect(html).toContain("Hallo Anna");
});

test("day14FeedbackEmail: malicious name is escaped", () => {
  const { html } = day14FeedbackEmail(EVIL, DUMMY_EMAIL, "de");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("day30TrustpilotEmail: malicious name is escaped", () => {
  const { html } = day30TrustpilotEmail(EVIL, DUMMY_EMAIL, "de");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("day14FeedbackEmail: null name falls back gracefully", () => {
  const { html } = day14FeedbackEmail(null, DUMMY_EMAIL, "de");
  expect(html).toContain("Hallo,");
});
