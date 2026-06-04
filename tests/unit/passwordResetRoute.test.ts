// tests/unit/passwordResetRoute.test.ts
//
// Unit tests for POST /api/auth/password-reset (handlePasswordResetPost).
//
// What is covered:
//   1. Happy path — generateLink + enqueueEmail called with the correct args,
//      response is always { ok: true }.
//   2. Enumeration prevention — route returns { ok: true } even when
//      generateLink fails (unknown email, Supabase error, missing action_link).
//   3. Locale resolution — profiles.language "en" → enqueue receives locale "en";
//      profiles.language absent or anything else → locale "de" (default).
//   4. redirectTo invariant — generateLink always receives `${appUrl}/auth/confirm`.
//   5. Display name forwarding — name from profiles.display_name is passed to enqueue.
//
// Why Playwright runner (no browser):
//   The project's only test runner is Playwright. `playwright.config.ts` picks up
//   `tests/unit/*.test.ts` automatically alongside the e2e specs. No DOM or dev
//   server is involved here — only the exported `handlePasswordResetPost` helper
//   is called in Node.
//
// Approach — injectable deps (same pattern as handleConfirmPost / handleInsulinPost):
//   `handlePasswordResetPost(email, appUrl, { sb, enqueue })` accepts a fake
//   Supabase admin client and a fake `enqueue` function, so every code path
//   can be driven without a live Supabase instance or Resend.

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  handlePasswordResetPost,
  type PasswordResetDeps,
} from "@/app/api/auth/password-reset/route";
import type { PasswordResetPayload } from "@/lib/emails/outbox";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EMAIL = "user@example.com";
const TEST_APP_URL = "https://glev.app";
const TEST_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEST_ACTION_LINK = "https://glev.app/auth/confirm?token_hash=abc123&type=recovery";

type EnqueueCall = Parameters<PasswordResetDeps["enqueue"]>[0];

/**
 * Build a minimal fake Supabase admin client.
 *
 * `generateLinkResult` controls what `auth.admin.generateLink` resolves to.
 * `profileRow` controls what `from("profiles").select(...).eq(...).maybeSingle()` returns.
 */
function makeDeps(opts: {
  generateLinkResult?: {
    data: {
      properties?: { action_link?: string };
      user?: { id?: string };
    } | null;
    error?: { message: string } | null;
  };
  profileRow?: { language?: string; display_name?: string } | null;
  enqueueSpy?: (call: EnqueueCall) => void;
}): { deps: PasswordResetDeps; enqueueCalls: EnqueueCall[]; generateLinkArgs: unknown[] } {
  const enqueueCalls: EnqueueCall[] = [];
  const generateLinkArgs: unknown[] = [];

  const defaultLinkResult = {
    data: {
      properties: { action_link: TEST_ACTION_LINK },
      user: { id: TEST_USER_ID },
    },
    error: null,
  };

  const sb = {
    auth: {
      admin: {
        async generateLink(args: unknown) {
          generateLinkArgs.push(args);
          return opts.generateLinkResult ?? defaultLinkResult;
        },
      },
    },
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                async maybeSingle() {
                  return {
                    data: opts.profileRow !== undefined ? opts.profileRow : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const enqueue = async (call: EnqueueCall): Promise<{ id: string; deduplicated: boolean }> => {
    enqueueCalls.push(call);
    opts.enqueueSpy?.(call);
    return { id: "test-id", deduplicated: false };
  };

  return { deps: { sb, enqueue }, enqueueCalls, generateLinkArgs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: generateLink called with correct type, email, and redirectTo", async () => {
  const { deps, generateLinkArgs } = makeDeps({});

  const res = await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);
  const json = await res.json();

  expect(json).toEqual({ ok: true });
  expect(generateLinkArgs).toHaveLength(1);

  const arg = generateLinkArgs[0] as {
    type: string;
    email: string;
    options: { redirectTo: string };
  };
  expect(arg.type).toBe("recovery");
  expect(arg.email).toBe(TEST_EMAIL);
  expect(arg.options.redirectTo).toBe(`${TEST_APP_URL}/auth/confirm`);
});

test("happy path: enqueueEmail called with template 'password-reset' and correct payload", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: { language: "de", display_name: "Anna" },
  });

  const res = await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);
  const json = await res.json();

  expect(json).toEqual({ ok: true });
  expect(enqueueCalls).toHaveLength(1);

  const call = enqueueCalls[0];
  const payload = call.payload as PasswordResetPayload;
  expect(call.recipient).toBe(TEST_EMAIL);
  expect(call.template).toBe("password-reset");
  expect(payload.resetUrl).toBe(TEST_ACTION_LINK);
  expect(payload.appUrl).toBe(TEST_APP_URL);
  expect(payload.locale).toBe("de");
  expect(payload.name).toBe("Anna");
});

test("enumeration prevention: returns { ok: true } when generateLink fails", async () => {
  const { deps, enqueueCalls } = makeDeps({
    generateLinkResult: {
      data: null,
      error: { message: "User not found" },
    },
  });

  const res = await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);
  const json = await res.json();

  expect(json).toEqual({ ok: true });
  expect(enqueueCalls).toHaveLength(0);
});

test("enumeration prevention: returns { ok: true } when action_link is missing", async () => {
  const { deps, enqueueCalls } = makeDeps({
    generateLinkResult: {
      data: { properties: {}, user: { id: TEST_USER_ID } },
      error: null,
    },
  });

  const res = await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);
  const json = await res.json();

  expect(json).toEqual({ ok: true });
  expect(enqueueCalls).toHaveLength(0);
});

test("locale de: profiles.language absent → enqueue receives locale 'de'", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: null,
  });

  await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);

  expect(enqueueCalls).toHaveLength(1);
  expect(enqueueCalls[0].payload.locale).toBe("de");
});

test("locale de: profiles.language='de' → enqueue receives locale 'de'", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: { language: "de", display_name: undefined },
  });

  await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);

  expect(enqueueCalls).toHaveLength(1);
  expect(enqueueCalls[0].payload.locale).toBe("de");
});

test("locale en: profiles.language='en' → enqueue receives locale 'en'", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: { language: "en", display_name: "John" },
  });

  await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);

  expect(enqueueCalls).toHaveLength(1);
  expect(enqueueCalls[0].payload.locale).toBe("en");
  expect(enqueueCalls[0].payload.name).toBe("John");
});

test("locale de: profiles.language='fr' (unsupported) → enqueue receives locale 'de' fallback", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: { language: "fr", display_name: undefined },
  });

  await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);

  expect(enqueueCalls).toHaveLength(1);
  expect(enqueueCalls[0].payload.locale).toBe("de");
});

test("display name: null display_name forwarded as null to enqueue", async () => {
  const { deps, enqueueCalls } = makeDeps({
    profileRow: { language: "de", display_name: undefined },
  });

  await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, deps);

  expect(enqueueCalls).toHaveLength(1);
  expect(enqueueCalls[0].payload.name).toBeNull();
});

test("redirectTo: always ends with /auth/confirm for any appUrl", async () => {
  const urls = [
    "https://glev.app",
    "https://staging.glev.app",
    "https://preview.glev.app",
  ];

  for (const appUrl of urls) {
    const { deps, generateLinkArgs } = makeDeps({});
    await handlePasswordResetPost(TEST_EMAIL, appUrl, deps);

    const arg = generateLinkArgs[0] as {
      options: { redirectTo: string };
    };
    expect(arg.options.redirectTo, `appUrl: ${appUrl}`).toBe(
      `${appUrl}/auth/confirm`,
    );
  }
});

test("always returns { ok: true } even when enqueue throws", async () => {
  const { deps } = makeDeps({
    profileRow: { language: "de", display_name: "Test" },
  });

  const throwingDeps: PasswordResetDeps = {
    sb: deps.sb,
    enqueue: async () => {
      throw new Error("Resend outage");
    },
  };

  const res = await handlePasswordResetPost(TEST_EMAIL, TEST_APP_URL, throwingDeps);
  const json = await res.json();

  expect(json).toEqual({ ok: true });
});
