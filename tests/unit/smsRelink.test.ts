/**
 * Unit tests for POST /api/admin/sms-relink
 *
 * Coverage:
 *  - 401 when no valid admin token is provided
 *  - 400 when userId is missing
 *  - 400 when user has no phone number
 *  - 409 when user is already opted out
 *  - 503 when TWILIO_* env vars are absent
 *  - 200 happy path: correct SMS body contains opt-out URL, audit row inserted
 *
 * Dependencies are mocked by replacing globalThis.fetch so that both the
 * Supabase JS SDK (which uses global fetch in Node.js) and the direct Twilio
 * fetch call in the route handler are intercepted without a real network.
 */

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/sms-relink/route";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_ADMIN_SECRET = "test-admin-secret-for-sms-relink!!";
const TEST_SMS_SECRET   = "test-sms-unsub-secret-32chars-!!!";
const TEST_USER_ID      = "aaaaaaaa-1111-2222-3333-444444444444";
const TEST_PHONE        = "+4917612345678";
const FAKE_SUPABASE_URL = "http://fake-supabase.smsrelink.test";

// ─── Env-var lifecycle ────────────────────────────────────────────────────────

const SAVED_ENV: Record<string, string | undefined> = {};
const MANAGED_VARS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_API_SECRET",
  "SMS_UNSUB_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
];

beforeAll(() => {
  for (const k of MANAGED_VARS) SAVED_ENV[k] = process.env[k];

  process.env.SUPABASE_URL              = FAKE_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.ADMIN_API_SECRET          = TEST_ADMIN_SECRET;
  process.env.SMS_UNSUB_SECRET          = TEST_SMS_SECRET;

  // Twilio vars — individual tests override / delete as needed.
  process.env.TWILIO_ACCOUNT_SID   = "ACtest000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN    = "test-twilio-token";
  process.env.TWILIO_FROM_NUMBER   = "+15005550006";

  // Install global fetch mock.
  globalThis.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of MANAGED_VARS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

// ─── Fetch mock infrastructure ────────────────────────────────────────────────

const realFetch = globalThis.fetch;

/**
 * Per-test fetch responder. Set this before calling POST() and reset after.
 * Signature matches the URL string after coercion.
 */
type FetchResponder = (url: string, init: RequestInit) => Promise<Response>;
let currentFetchResponder: FetchResponder | null = null;

async function mockFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (currentFetchResponder) {
    return currentFetchResponder(url, init);
  }
  throw new Error(`[test] Unexpected fetch — no responder set. URL: ${url}`);
}

/** Returns a fetch responder pre-wired for a normal happy-path scenario. */
function makeResponder(opts: {
  userPhone?: string;
  smsOptedOut?: boolean;
  auditLog?: Array<Record<string, unknown>>;
  twilioOk?: boolean;
}): FetchResponder {
  const {
    userPhone    = TEST_PHONE,
    smsOptedOut  = false,
    auditLog     = [],
    twilioOk     = true,
  } = opts;

  return async (url, _init) => {
    // Supabase Auth Admin — getUserById
    if (url.includes("/auth/v1/admin/users/")) {
      const body = {
        id: TEST_USER_ID,
        phone: userPhone,
        user_metadata: {},
        email: "test@example.com",
        created_at: new Date().toISOString(),
      };
      return new Response(JSON.stringify(body), {
        status:  200,
        headers: { "content-type": "application/json" },
      });
    }

    // Supabase REST — profiles select
    if (url.includes("/rest/v1/profiles")) {
      const row = smsOptedOut ? [{ sms_opted_out: true }] : [];
      return new Response(JSON.stringify(row), {
        status:  200,
        headers: { "content-type": "application/json" },
      });
    }

    // Supabase REST — sms_optout_events insert
    if (url.includes("/rest/v1/sms_optout_events")) {
      auditLog.push(JSON.parse((_init as { body?: string }).body ?? "{}") as Record<string, unknown>);
      return new Response("[]", {
        status:  201,
        headers: { "content-type": "application/json" },
      });
    }

    // Twilio Messages API
    if (url.includes("api.twilio.com")) {
      if (!twilioOk) {
        return new Response(JSON.stringify({ message: "Test Twilio error" }), {
          status:  400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          sid: "SMtest000000000000000000000000",
          to: TEST_PHONE,
          num_segments: "1",
        }),
        {
          status:  201,
          headers: { "content-type": "application/json" },
        },
      );
    }

    throw new Error(`[test] Unhandled URL in fetch mock: ${url}`);
  };
}

// ─── Request helper ───────────────────────────────────────────────────────────

function buildRequest(
  body: Record<string, unknown>,
  opts: { bearer?: string } = {},
): NextRequest {
  const bearer = opts.bearer ?? TEST_ADMIN_SECRET;
  return new NextRequest("http://localhost/api/admin/sms-relink", {
    method:  "POST",
    headers: {
      "content-type":  "application/json",
      "authorization": `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("401 when no Authorization header is provided", async () => {
  currentFetchResponder = makeResponder({});
  try {
    const req = new NextRequest("http://localhost/api/admin/sms-relink", {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({ userId: TEST_USER_ID }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/[Uu]nauthorized/);
  } finally {
    currentFetchResponder = null;
  }
});

test("401 when wrong Bearer token is provided", async () => {
  currentFetchResponder = makeResponder({});
  try {
    const req = buildRequest({ userId: TEST_USER_ID }, { bearer: "wrong-secret" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  } finally {
    currentFetchResponder = null;
  }
});

test("400 when userId is missing from the request body", async () => {
  currentFetchResponder = makeResponder({});
  try {
    const req = buildRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBeTruthy();
  } finally {
    currentFetchResponder = null;
  }
});

test("400 when user has no phone number", async () => {
  currentFetchResponder = makeResponder({ userPhone: "" });
  try {
    const req = buildRequest({ userId: TEST_USER_ID });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/[Tt]elefon|phone/i);
  } finally {
    currentFetchResponder = null;
  }
});

test("409 when user is already opted out", async () => {
  currentFetchResponder = makeResponder({ smsOptedOut: true });
  try {
    const req = buildRequest({ userId: TEST_USER_ID });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toBeTruthy();
  } finally {
    currentFetchResponder = null;
  }
});

test("503 when TWILIO_* env vars are absent", async () => {
  // Remove Twilio vars for this test.
  const savedSid   = process.env.TWILIO_ACCOUNT_SID;
  const savedToken = process.env.TWILIO_AUTH_TOKEN;
  const savedFrom  = process.env.TWILIO_FROM_NUMBER;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;

  currentFetchResponder = makeResponder({});
  try {
    const req = buildRequest({ userId: TEST_USER_ID });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/[Tt]wilio/);
  } finally {
    currentFetchResponder = null;
    process.env.TWILIO_ACCOUNT_SID  = savedSid;
    process.env.TWILIO_AUTH_TOKEN   = savedToken;
    process.env.TWILIO_FROM_NUMBER  = savedFrom;
  }
});

test("200 happy path: SMS body contains opt-out URL and audit row is inserted", async () => {
  const auditLog: Array<Record<string, unknown>> = [];
  let capturedSmsBody = "";

  currentFetchResponder = async (url, init) => {
    if (url.includes("/auth/v1/admin/users/")) {
      return new Response(
        JSON.stringify({
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          user_metadata: {},
          created_at: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes("/rest/v1/profiles")) {
      return new Response("[]", {
        status:  200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/rest/v1/sms_optout_events")) {
      auditLog.push(JSON.parse((init as { body?: string }).body ?? "{}") as Record<string, unknown>);
      return new Response("[]", {
        status:  201,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("api.twilio.com")) {
      // Capture the SMS body sent to Twilio.
      const formBody = (init as { body?: string }).body ?? "";
      const params = new URLSearchParams(formBody);
      capturedSmsBody = params.get("Body") ?? "";

      return new Response(
        JSON.stringify({
          sid: "SMtest999999999999999999999999",
          to: TEST_PHONE,
          num_segments: "1",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`[test] Unhandled URL: ${url}`);
  };

  try {
    const req = buildRequest({ userId: TEST_USER_ID });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; sid: string };
    expect(json.ok).toBe(true);
    expect(json.sid).toBe("SMtest999999999999999999999999");

    // SMS body must contain the opt-out URL with the user id.
    expect(capturedSmsBody).toContain("/sms-stop");
    expect(capturedSmsBody).toContain(encodeURIComponent(TEST_USER_ID));

    // Audit row must have been inserted with event_type = 'relink'.
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]).toMatchObject({
      user_id:    TEST_USER_ID,
      event_type: "relink",
      user_agent: "admin/sms-relink",
    });
    expect(typeof auditLog[0].token_used).toBe("string");
    expect((auditLog[0].token_used as string).length).toBeGreaterThan(0);
  } finally {
    currentFetchResponder = null;
  }
});
