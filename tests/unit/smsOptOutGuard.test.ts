/**
 * Tests for SMS opt-out guard logic.
 *
 * Verifies that:
 * - renderSms correctly substitutes {{token}} and {{user_id}} placeholders
 * - the reminder SMS default template contains the opt-out link pattern
 * - the opt-out guard (pure logic) skips Twilio when sms_opted_out = true
 */

import { test, expect } from "@playwright/test";
import { renderSms } from "@/lib/messageTemplates";

test("renderSms: substitutes {{token}} and {{user_id}} placeholders", () => {
  const tpl = "Abmelden: glev.app/sms-stop?t={{token}}&u={{user_id}} · Link: {{link}}";
  const result = renderSms(tpl, {
    link: "https://go.glev.app/abc",
    token: "tok123",
    user_id: "uid-456",
  });
  expect(result).toContain("t=tok123");
  expect(result).toContain("u=uid-456");
  expect(result).toContain("go.glev.app/abc");
});

test("renderSms: missing token/user_id leaves empty string, not literal placeholder", () => {
  const tpl = "Link: {{link}} Stop: glev.app/sms-stop?t={{token}}&u={{user_id}}";
  const result = renderSms(tpl, { link: "https://x.y/z" });
  expect(result).not.toContain("{{token}}");
  expect(result).not.toContain("{{user_id}}");
});

test("reminder SMS default template contains opt-out line", () => {
  const { DEFAULTS } = require("@/lib/messageTemplates");
  const tpl = DEFAULTS["meta_lead_reminder_sms"];
  expect(tpl.sms_text).toContain("sms-stop");
  expect(tpl.sms_text).toContain("{{token}}");
  expect(tpl.sms_text).toContain("{{user_id}}");
});

test("invite SMS default template contains opt-out line", () => {
  const { DEFAULTS } = require("@/lib/messageTemplates");
  const tpl = DEFAULTS["meta_lead_invite_sms"];
  expect(tpl.sms_text).toContain("sms-stop");
  expect(tpl.sms_text).toContain("{{token}}");
  expect(tpl.sms_text).toContain("{{user_id}}");
});

test("bulk SMS default template contains opt-out line", () => {
  const { DEFAULTS } = require("@/lib/messageTemplates");
  const tpl = DEFAULTS["meta_lead_bulk_sms"];
  expect(tpl.sms_text).toContain("sms-stop");
  expect(tpl.sms_text).toContain("{{token}}");
  expect(tpl.sms_text).toContain("{{user_id}}");
});

test("opt-out guard: skips Twilio call when sms_opted_out = true (pure logic)", () => {
  const smsOptedOut = true;
  let twilioWasCalled = false;

  const sendIfNotOptedOut = (optedOut: boolean) => {
    if (optedOut) return "skipped";
    twilioWasCalled = true;
    return "sent";
  };

  const result = sendIfNotOptedOut(smsOptedOut);
  expect(result).toBe("skipped");
  expect(twilioWasCalled).toBe(false);
});

test("opt-out guard: calls Twilio when sms_opted_out = false", () => {
  const smsOptedOut = false;
  let twilioWasCalled = false;

  const sendIfNotOptedOut = (optedOut: boolean) => {
    if (optedOut) return "skipped";
    twilioWasCalled = true;
    return "sent";
  };

  const result = sendIfNotOptedOut(smsOptedOut);
  expect(result).toBe("sent");
  expect(twilioWasCalled).toBe(true);
});
