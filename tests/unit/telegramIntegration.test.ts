// tests/unit/telegramIntegration.test.ts
//
// End-to-end integration test for the Telegram webhook → Supabase →
// notify-script round-trip.
//
// ─── Coverage ────────────────────────────────────────────────────────────────
//   1. POST /api/telegram/webhook with a valid secret and a text reply that
//      contains a backtick task-id → handler calls the Supabase REST INSERT
//      with the correct payload (task_id, direction="inbound", message).
//   2. Secret validation: wrong / missing secret → 401, never touches Supabase.
//   3. Voice-duration guard: voice note > 60 s → 413, never touches Supabase.
//   4. Duplicate update_id: second identical update_id → 200 ok, Supabase
//      INSERT called only once.
//   5. No-op updates: missing message, no reply context, no task-id in reply.
//   6. Notify-script resolution logic (shouldResolveInbound from shared module):
//      imported from the REAL scripts/lib/telegramResolve.mjs via subprocess —
//      not an inline copy — so script and tests share a single source of truth.
//   7. Subprocess smoke tests: notify-telegram.mjs validates args and env vars
//      and exits with code 1 (+ correct stderr) when they are missing.
//
// ─── CI-safe design ──────────────────────────────────────────────────────────
//   • No live Telegram bot — only text replies, no voice download triggered.
//   • No live Supabase instance — a local Node.js HTTP server mimics the
//     Supabase REST API at POST /rest/v1/agent_messages.
//   • Resolution-predicate tests run the real scripts/lib/telegramResolve.mjs
//     via Node subprocess — no module-import compatibility hacks needed.
//   • Each test resets captured state and uses a fresh update_id so the
//     module-level dedup cache in route.ts does not interfere.

import { test, expect, beforeAll, afterAll } from "@playwright/test";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/telegram/webhook/route";

// ─── Mock Supabase REST server ────────────────────────────────────────────────

/**
 * The last request body received by the mock Supabase REST server.
 * Reset to `null` before each assertion.
 */
let lastSupabasePayload: Record<string, unknown> | null = null;

const mockSupabaseServer = createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    if (
      req.method === "POST" &&
      req.url?.startsWith("/rest/v1/agent_messages")
    ) {
      let body = "";
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          lastSupabasePayload = JSON.parse(body) as Record<string, unknown>;
        } catch {
          lastSupabasePayload = null;
        }
        // Supabase REST returns 201 Created for successful inserts.
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end("[]");
      });
      return;
    }

    // Other Supabase SDK internal endpoints — respond 200 to avoid timeouts.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  },
);

/** Base URL of the mock Supabase server, set once the server starts. */
let mockSupabaseUrl = "";

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    mockSupabaseServer.listen(0, "127.0.0.1", () => {
      const addr = mockSupabaseServer.address() as AddressInfo;
      mockSupabaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    mockSupabaseServer.close(() => resolve()),
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-webhook-secret-32-chars-long!!";

/** Project root — used for resolving scripts in subprocess invocations. */
const PROJECT_ROOT = pathResolve(__dirname, "../..");

/**
 * Constructs a NextRequest for the webhook handler.
 */
function buildRequest(
  body: object,
  options: {
    secret?: string;
    ip?: string;
    overrideHeaders?: Record<string, string>;
  } = {},
): NextRequest {
  const {
    secret = TEST_SECRET,
    ip = "10.0.0.1",
    overrideHeaders = {},
  } = options;

  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
      "x-forwarded-for": ip,
      ...overrideHeaders,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Returns a Telegram update body for a text reply to a bot message whose
 * text contains a backtick task-id — exactly the format sent by
 * notify-telegram.mjs.
 *
 *   🤖 Replit-Frage (Task `<taskId>`)
 *   <question>
 *   _Antworte direkt auf diese Nachricht …_
 */
function textReplyUpdate(
  taskId: string,
  replyText: string,
  updateId = 2001,
): object {
  return {
    update_id: updateId,
    message: {
      message_id: 10,
      text: replyText,
      reply_to_message: {
        text:
          `🤖 Replit-Frage (Task \`${taskId}\`)\n\n` +
          `Soll ich Option A oder B wählen?\n\n` +
          `_Antworte direkt auf diese Nachricht — der Agent wartet bis zu 10 Minuten._`,
      },
    },
  };
}

/**
 * Sets env vars for the duration of `fn`, then restores originals.
 */
async function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, orig] of Object.entries(saved)) {
      if (orig === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = orig;
      }
    }
  }
}

// ─── Tests: webhook POST handler → Supabase INSERT ───────────────────────────

test("happy path — text reply with backtick task-id writes correct inbound row", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest(
        textReplyUpdate("9876543210", "Ja, Option A bitte.", 3001),
      );
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean };
      expect(json.ok).toBe(true);
    },
  );

  expect(lastSupabasePayload).not.toBeNull();
  expect(lastSupabasePayload).toMatchObject({
    task_id: "9876543210",
    direction: "inbound",
    message: "Ja, Option A bitte.",
  });
});

test("happy path — task-id embedded deep in a multi-line reply", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest(
        textReplyUpdate("4430000000001", "Option B ist besser.", 3002),
      );
      const res = await POST(req);
      expect(res.status).toBe(200);
    },
  );

  expect(lastSupabasePayload).toMatchObject({
    task_id: "4430000000001",
    direction: "inbound",
    message: "Option B ist besser.",
  });
});

// ─── Tests: secret validation ─────────────────────────────────────────────────

test("wrong secret → 401, Supabase never called", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest(textReplyUpdate("111", "hi", 3010), {
        secret: "wrong-secret",
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

test("missing secret header → 401, Supabase never called", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest(textReplyUpdate("222", "hi", 3011), {
        overrideHeaders: { "x-telegram-bot-api-secret-token": "" },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

test("unconfigured TELEGRAM_WEBHOOK_SECRET → 500", async () => {
  await withEnv(
    {
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const original = process.env.TELEGRAM_WEBHOOK_SECRET;
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      try {
        const req = buildRequest(textReplyUpdate("333", "hi", 3012));
        const res = await POST(req);
        expect(res.status).toBe(500);
      } finally {
        if (original !== undefined) process.env.TELEGRAM_WEBHOOK_SECRET = original;
      }
    },
  );
});

// ─── Tests: voice duration guard ─────────────────────────────────────────────

test("voice note > 60 s → 413, Supabase never called", async () => {
  lastSupabasePayload = null;

  const voiceUpdate = {
    update_id: 3020,
    message: {
      message_id: 20,
      voice: {
        file_id: "file-abc",
        duration: 61, // exceeds VOICE_MAX_DURATION_SECONDS (60)
        mime_type: "audio/ogg",
      },
      reply_to_message: {
        text: `🤖 Replit-Frage (Task \`9999\`)\n\nFrage?`,
      },
    },
  };

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      TELEGRAM_BOT_TOKEN: "dummy-bot-token",
    },
    async () => {
      const req = buildRequest(voiceUpdate);
      const res = await POST(req);
      expect(res.status).toBe(413);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

// ─── Tests: update_id deduplication ──────────────────────────────────────────

test("duplicate update_id → 200 ok but Supabase INSERT called only once", async () => {
  const UPDATE_ID = 9_990_002; // high enough to be fresh in the module-level cache

  let firstPayload: Record<string, unknown> | null = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      lastSupabasePayload = null;

      // First request — should be processed normally.
      const req1 = buildRequest(
        textReplyUpdate("5550000000002", "Erste Antwort.", UPDATE_ID),
      );
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      firstPayload = lastSupabasePayload;
      expect(firstPayload).not.toBeNull();

      // Second request with the same update_id — should be deduped.
      const req2 = buildRequest(
        textReplyUpdate("5550000000002", "Erste Antwort.", UPDATE_ID),
        { ip: "10.0.0.2" }, // different IP so rate-limiter doesn't interfere
      );
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);

      // Mock server payload must still be the first one — no second INSERT.
      expect(lastSupabasePayload).toBe(firstPayload);
    },
  );
});

// ─── Tests: edge cases — updates without relevant content ────────────────────

test("update without message field → 200 ok, Supabase not called", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest({ update_id: 4001 });
      const res = await POST(req);
      expect(res.status).toBe(200);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

test("reply without task-id in parent text → 200 ok, Supabase not called", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest({
        update_id: 4002,
        message: {
          message_id: 30,
          text: "Ja klar.",
          reply_to_message: {
            text: "Hey, kannst du mir helfen?", // no "Task `…`" pattern
          },
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

test("plain message (no reply_to_message) → 200 ok, Supabase not called", async () => {
  lastSupabasePayload = null;

  await withEnv(
    {
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
    async () => {
      const req = buildRequest({
        update_id: 4003,
        message: {
          message_id: 31,
          text: "Just a normal message, no reply context.",
        },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    },
  );

  expect(lastSupabasePayload).toBeNull();
});

// ─── Tests: shouldResolveInbound — real module via subprocess ─────────────────
//
// The notify-script (scripts/notify-telegram.mjs) imports its resolution
// predicate from scripts/lib/telegramResolve.mjs.  These tests invoke that
// shared module directly via a Node.js subprocess so:
//   • There is a single source of truth — if the predicate changes in the
//     module, these tests break immediately (unlike an inline copy that silently
//     diverges).
//   • No TypeScript/ESM import-compatibility hacks are needed.
//
// Subprocess approach: `node --input-type=module -e "<ESM code>"` with an
// absolute path to the .mjs file so the import always resolves from CWD.

/** Absolute path to the shared resolution-predicate module. */
const RESOLVE_MODULE = pathResolve(
  PROJECT_ROOT,
  "scripts/lib/telegramResolve.mjs",
);

/**
 * Runs a small ESM snippet that imports shouldResolveInbound from the real
 * module and serialises the result as JSON to stdout.
 *
 * Returns `{ stdout, stderr, status }`.
 */
function runResolveCheck(
  row: { direction: string; created_at: string; message: string },
  sentAt: string,
): { result: string | null; stderr: string; status: number | null } {
  const code = `
import { shouldResolveInbound } from '${RESOLVE_MODULE}';
const row = ${JSON.stringify(row)};
const result = shouldResolveInbound(row, ${JSON.stringify(sentAt)});
console.log(JSON.stringify(result));
`.trim();

  const proc = spawnSync("node", ["--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: 10_000,
  });

  const stdout = proc.stdout?.trim() ?? "";
  return {
    result: stdout ? (JSON.parse(stdout) as string | null) : null,
    stderr: proc.stderr ?? "",
    status: proc.status,
  };
}

test("shouldResolveInbound (real module): inbound + created_at ≥ sentAt → message", () => {
  const { result, status } = runResolveCheck(
    {
      direction: "inbound",
      created_at: "2026-05-21T10:00:05.123Z",
      message: "Ja, Option A.",
    },
    "2026-05-21T10:00:00.000Z",
  );
  expect(status).toBe(0);
  expect(result).toBe("Ja, Option A.");
});

test("shouldResolveInbound (real module): direction=outbound → null", () => {
  const { result, status } = runResolveCheck(
    {
      direction: "outbound",
      created_at: "2026-05-21T10:00:05.123Z",
      message: "Soll ich A oder B wählen?",
    },
    "2026-05-21T10:00:00.000Z",
  );
  expect(status).toBe(0);
  expect(result).toBeNull();
});

test("shouldResolveInbound (real module): created_at < sentAt (stale row) → null", () => {
  const { result, status } = runResolveCheck(
    {
      direction: "inbound",
      created_at: "2026-05-21T09:59:59.999Z", // 1 ms before sentAt
      message: "Old answer from a previous question.",
    },
    "2026-05-21T10:00:00.000Z",
  );
  expect(status).toBe(0);
  expect(result).toBeNull();
});

test("shouldResolveInbound (real module): created_at === sentAt (exact boundary) → message", () => {
  const { result, status } = runResolveCheck(
    {
      direction: "inbound",
      created_at: "2026-05-21T10:00:00.000Z",
      message: "Boundary answer.",
    },
    "2026-05-21T10:00:00.000Z",
  );
  expect(status).toBe(0);
  expect(result).toBe("Boundary answer.");
});

// ─── Tests: waitForReply subscription wiring (real module via subprocess) ─────
//
// These tests invoke scripts/lib/telegramNotify.mjs's `waitForReply()` in a
// Node subprocess with a *fake* Supabase client that captures channel setup
// parameters and fires callbacks synchronously. This validates:
//   • The Supabase channel is created with the correct name
//   • The postgres_changes filter has the right event, schema, table, and
//     filter string (task_id=eq.<taskId>)
//   • A matching inbound row resolves the promise with the message text
//   • An outbound row is ignored
//   • A stale row (created_at < sentAt) is ignored
//   • The promise resolves "TIMEOUT" after the configured timeoutMs

const NOTIFY_MODULE = pathResolve(
  PROJECT_ROOT,
  "scripts/lib/telegramNotify.mjs",
);

/**
 * Runs a Node subprocess that:
 *   1. Imports waitForReply from the real scripts/lib/telegramNotify.mjs
 *   2. Constructs a fake Supabase client
 *   3. Calls waitForReply(taskId, sentAt, fakeSupabase, opts)
 *   4. Optionally fires a Realtime callback payload after subscription
 *   5. Prints JSON result to stdout
 *
 * `payloadJson` — if provided, the fake channel fires this payload via the
 *   registered callback immediately after subscribe() is called.
 *   Pass null to let the promise time out.
 */
function runWaitForReplyTest(
  taskId: string,
  sentAt: string,
  payloadJson: object | null,
  timeoutMs = 2000,
): {
  stdout: string;
  stderr: string;
  status: number | null;
  captured: {
    channelName: string;
    filterEvent: string;
    filterSchema: string;
    filterTable: string;
    filterString: string;
  } | null;
} {
  const payloadArg = payloadJson === null ? "null" : JSON.stringify(payloadJson);

  const code = `
import { waitForReply } from '${NOTIFY_MODULE}';

const TASK_ID = ${JSON.stringify(taskId)};
const SENT_AT = ${JSON.stringify(sentAt)};
const PAYLOAD = ${payloadArg};
const TIMEOUT_MS = ${timeoutMs};

// ── Fake Supabase client ──────────────────────────────────────────────────
let capturedChannelName = null;
let capturedFilterEvent = null;
let capturedFilterSchema = null;
let capturedFilterTable = null;
let capturedFilterString = null;
let registeredCallback = null;

const fakeChannel = {
  on(changeType, filter, cb) {
    // The Supabase JS client passes 'postgres_changes' as changeType;
    // event: 'INSERT' lives inside the filter object.
    capturedFilterEvent = filter.event;
    capturedFilterSchema = filter.schema;
    capturedFilterTable  = filter.table;
    capturedFilterString = filter.filter;
    registeredCallback   = cb;
    return this;
  },
  subscribe() {
    // Fire the payload immediately after the subscription is registered,
    // if one was provided. setImmediate so the Promise executor has time
    // to set 'resolved = false' before we call the callback.
    if (PAYLOAD !== null) {
      setImmediate(() => registeredCallback({ new: PAYLOAD }));
    }
    return this;
  },
  unsubscribe() {},
};

const fakeSupabase = {
  channel(name) {
    capturedChannelName = name;
    return fakeChannel;
  },
};

const result = await waitForReply(TASK_ID, SENT_AT, fakeSupabase, { timeoutMs: TIMEOUT_MS });

console.log(JSON.stringify({
  result,
  channelName:    capturedChannelName,
  filterEvent:    capturedFilterEvent,
  filterSchema:   capturedFilterSchema,
  filterTable:    capturedFilterTable,
  filterString:   capturedFilterString,
}));
`.trim();

  const proc = spawnSync("node", ["--input-type=module", "-e", code], {
    encoding: "utf8",
    timeout: timeoutMs + 5_000,
  });

  let parsed: {
    result: string;
    channelName: string;
    filterEvent: string;
    filterSchema: string;
    filterTable: string;
    filterString: string;
  } | null = null;

  try {
    parsed = JSON.parse(proc.stdout?.trim() ?? "");
  } catch {
    parsed = null;
  }

  return {
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    status: proc.status,
    captured: parsed
      ? {
          channelName: parsed.channelName,
          filterEvent: parsed.filterEvent,
          filterSchema: parsed.filterSchema,
          filterTable: parsed.filterTable,
          filterString: parsed.filterString,
        }
      : null,
  };
}

test("waitForReply — channel name is agent_messages:<taskId>", () => {
  const { status, captured } = runWaitForReplyTest(
    "9990111",
    "2026-05-21T10:00:00.000Z",
    {
      direction: "inbound",
      created_at: "2026-05-21T10:00:01.000Z",
      message: "Ja.",
    },
  );
  expect(status).toBe(0);
  expect(captured?.channelName).toBe("agent_messages:9990111");
});

test("waitForReply — postgres_changes filter wired correctly (event, schema, table, filter string)", () => {
  const TASK_ID = "9990222";
  const { status, captured } = runWaitForReplyTest(
    TASK_ID,
    "2026-05-21T10:00:00.000Z",
    {
      direction: "inbound",
      created_at: "2026-05-21T10:00:01.000Z",
      message: "ok.",
    },
  );
  expect(status).toBe(0);
  expect(captured?.filterEvent).toBe("INSERT");
  expect(captured?.filterSchema).toBe("public");
  expect(captured?.filterTable).toBe("agent_messages");
  expect(captured?.filterString).toBe(`task_id=eq.${TASK_ID}`);
});

test("waitForReply — valid inbound row resolves with message text", () => {
  const { stdout, status } = runWaitForReplyTest(
    "9990333",
    "2026-05-21T10:00:00.000Z",
    {
      direction: "inbound",
      created_at: "2026-05-21T10:00:05.000Z",
      message: "Option A bitte.",
    },
  );
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout.trim()) as { result: string };
  expect(parsed.result).toBe("Option A bitte.");
});

test("waitForReply — outbound row is ignored, promise eventually times out", () => {
  const { stdout, status } = runWaitForReplyTest(
    "9990444",
    "2026-05-21T10:00:00.000Z",
    {
      direction: "outbound", // should be ignored
      created_at: "2026-05-21T10:00:05.000Z",
      message: "This is our own outbound question.",
    },
    200, // very short timeout so the test doesn't block
  );
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout.trim()) as { result: string };
  expect(parsed.result).toBe("TIMEOUT");
});

test("waitForReply — stale row (created_at < sentAt) is ignored, promise times out", () => {
  const { stdout, status } = runWaitForReplyTest(
    "9990555",
    "2026-05-21T10:00:00.000Z",
    {
      direction: "inbound",
      created_at: "2026-05-21T09:59:59.000Z", // before sentAt
      message: "Old answer.",
    },
    200,
  );
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout.trim()) as { result: string };
  expect(parsed.result).toBe("TIMEOUT");
});

test("waitForReply — no payload fires → resolves TIMEOUT after timeoutMs", () => {
  const { stdout, status } = runWaitForReplyTest(
    "9990666",
    "2026-05-21T10:00:00.000Z",
    null, // no callback fired
    200,
  );
  expect(status).toBe(0);
  const parsed = JSON.parse(stdout.trim()) as { result: string };
  expect(parsed.result).toBe("TIMEOUT");
});

// ─── Tests: notify-telegram.mjs subprocess smoke tests ───────────────────────
//
// These tests exercise notify-telegram.mjs itself (not just the shared helper)
// to prove the script's argument-parsing and env-check paths work correctly.
// They run quickly because both failure paths exit before touching the network.

const NOTIFY_SCRIPT = pathResolve(PROJECT_ROOT, "scripts/notify-telegram.mjs");

test("notify-telegram.mjs — missing args → exit 1 + usage message", () => {
  const proc = spawnSync("node", [NOTIFY_SCRIPT], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env }, // inherit env so Node resolves imports correctly
  });

  expect(proc.status).toBe(1);
  expect(proc.stderr).toContain("Usage:");
  expect(proc.stderr).toContain("notify-telegram.mjs");
});

test("notify-telegram.mjs — valid args but missing env vars → exit 1 + lists missing vars", () => {
  const proc = spawnSync("node", [NOTIFY_SCRIPT, "1234567890", "Frage?"], {
    encoding: "utf8",
    timeout: 10_000,
    // Deliberately strip all Telegram / Supabase secrets from the env.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
  });

  expect(proc.status).toBe(1);
  expect(proc.stderr).toContain("Missing env vars:");
  // All four required vars should be listed.
  expect(proc.stderr).toContain("TELEGRAM_BOT_TOKEN");
  expect(proc.stderr).toContain("TELEGRAM_CHAT_ID");
  expect(proc.stderr).toContain("SUPABASE_URL");
  expect(proc.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
});
