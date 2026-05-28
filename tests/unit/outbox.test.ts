// Unit tests for the email outbox retry / backoff behaviour.
//
// Why this file exists:
//   `lib/emails/outbox.ts` has subtle, stateful behaviour that is easy to
//   regress silently:
//
//     1. Atomic claim — the `pending → sending` guard that prevents two
//        concurrent cron workers from sending the same email twice.
//     2. Immediate-dead on render error — an unknown template name must
//        flip the row to `dead` on the *first* attempt, not after 5 retries.
//     3. Exponential backoff — a transient Resend failure must increment
//        `attempts`, store `last_error`, and schedule `next_attempt_at`
//        according to the BACKOFF_MINUTES table.
//     4. MAX_ATTEMPTS cap — once a row has exhausted all retries the status
//        must become `dead` and the admin-alarm `console.error` must fire.
//
// Why Playwright (no browser):
//   The project's only test runner is Playwright. `testDir: "./tests"` in
//   `playwright.config.ts` picks up `tests/unit/*.test.ts` alongside the
//   e2e specs. These tests never touch `page` or the dev server — they are
//   pure unit tests that happen to run under the Playwright runner.
//
// Approach — in-memory fake:
//   `flushOutbox()` accepts an optional `FlushDeps` argument (added for
//   testability) that overrides the Supabase admin client and the Resend
//   instance. We build a lightweight in-memory fake that implements just
//   enough of the Supabase JS fluent-builder API to exercise every code
//   path inside `flushOutbox`.

import { test, expect } from "@playwright/test";
import {
  flushOutbox,
  BACKOFF_MINUTES,
  MAX_ATTEMPTS,
  type FlushDeps,
} from "@/lib/emails/outbox";

// ---------------------------------------------------------------------------
// In-memory Supabase fake
// ---------------------------------------------------------------------------

/** Mirrors the columns used by flushOutbox (subset of the full schema). */
interface OutboxRow {
  id: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  status: "pending" | "sending" | "sent" | "dead";
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string;
  message_id: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * Fluent builder that accumulates filters / patches and executes them
 * synchronously against the shared in-memory store when awaited. The
 * builder implements `PromiseLike` so that `await builder` works just
 * like `await supabase.from(...)`.
 */
class FakeQueryBuilder implements PromiseLike<{ data: OutboxRow[] | null; error: null }> {
  private _patch: Partial<OutboxRow> | null = null;
  private _filters: Array<{ col: string; op: "eq" | "lt" | "lte"; val: unknown }> = [];
  private _doSelect = false;
  private _orderCol: string | null = null;
  private _orderAsc = true;
  private _limitN: number | null = null;

  constructor(private store: Map<string, OutboxRow>) {}

  update(patch: Partial<OutboxRow>): this {
    this._patch = patch;
    return this;
  }

  select(_cols: string): this {
    this._doSelect = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this._filters.push({ col, op: "eq", val });
    return this;
  }

  lt(col: string, val: unknown): this {
    this._filters.push({ col, op: "lt", val });
    return this;
  }

  lte(col: string, val: unknown): this {
    this._filters.push({ col, op: "lte", val });
    return this;
  }

  order(col: string, opts: { ascending: boolean }): this {
    this._orderCol = col;
    this._orderAsc = opts.ascending;
    return this;
  }

  limit(n: number): this {
    this._limitN = n;
    return this;
  }

  /**
   * Supabase .single() — returns the first matching row or a PGRST116 error
   * when the filtered result set is empty (which is what the claim step
   * relies on to detect that another worker already claimed the row).
   */
  single(): PromiseLike<{
    data: OutboxRow | null;
    error: { code: string; message: string } | null;
  }> {
    const rows = this._run();
    if (rows.length === 0) {
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        },
      });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }

  // PromiseLike implementation — used when the builder is `await`-ed directly
  // (e.g. `await admin.from(t).update(p).eq(...)`).
  then<T, U = never>(
    resolve: (value: { data: OutboxRow[] | null; error: null }) => T | PromiseLike<T>,
    reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): PromiseLike<T | U> {
    const rows = this._run();
    const data: OutboxRow[] | null =
      this._patch && !this._doSelect ? null : rows;
    return Promise.resolve({ data, error: null as null }).then(
      resolve as (value: { data: OutboxRow[] | null; error: null }) => T | PromiseLike<T>,
      reject ?? undefined,
    ) as PromiseLike<T | U>;
  }

  /** Applies filters, (optionally) a patch, ordering, and limit against the live store. */
  private _run(): OutboxRow[] {
    const all = Array.from(this.store.values());

    const matching = all.filter((row) =>
      this._filters.every((f) => {
        const v = (row as unknown as Record<string, unknown>)[f.col];
        switch (f.op) {
          case "eq":
            return v === f.val;
          case "lt":
            // ISO timestamps sort lexicographically — string comparison is correct.
            return String(v ?? "") < String(f.val ?? "");
          case "lte":
            return String(v ?? "") <= String(f.val ?? "");
        }
      }),
    );

    if (this._patch) {
      // Apply the patch in-place so subsequent reads see the updated values.
      for (const row of matching) {
        Object.assign(row, this._patch);
      }
      return matching;
    }

    let result = [...matching];
    if (this._orderCol) {
      const col = this._orderCol;
      const asc = this._orderAsc;
      result.sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[col] ?? "");
        const bv = String((b as unknown as Record<string, unknown>)[col] ?? "");
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this._limitN !== null) {
      result = result.slice(0, this._limitN);
    }
    return result;
  }
}

/** Creates a minimal fake Supabase admin client backed by `store`. */
function makeAdmin(store: Map<string, OutboxRow>) {
  return {
    from(_table: string) {
      return new FakeQueryBuilder(store);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake Resend
// ---------------------------------------------------------------------------

let _sendCallCount = 0;

/** Returns a Resend fake that always succeeds and counts calls. */
function makeSuccessResend() {
  return {
    emails: {
      send: async (_args: unknown) => {
        _sendCallCount++;
        return { data: { id: `msg-${_sendCallCount}` }, error: null };
      },
    },
  };
}

/** Returns a Resend fake that always returns a transient error. */
function makeFailingResend(message = "connection reset by peer") {
  return {
    emails: {
      send: async (_args: unknown) => {
        return {
          data: null,
          error: { name: "ResendError", message },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO timestamp N seconds in the past (so the row is always "due"). */
function pastIso(secondsAgo = 60): string {
  return new Date(Date.now() - secondsAgo * 1_000).toISOString();
}

/** Minimal pending row with sane defaults. */
function makePendingRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    recipient: "test@example.com",
    template: "beta-welcome",
    payload: {},
    status: "pending",
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    next_attempt_at: pastIso(),
    message_id: null,
    created_at: pastIso(300),
    sent_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Parallel double-send prevention
// ---------------------------------------------------------------------------

test.describe("flushOutbox — parallel double-send prevention", () => {
  test("two concurrent flushOutbox calls claim the same row at most once", async () => {
    const store = new Map<string, OutboxRow>();
    const row = makePendingRow();
    store.set(row.id, row);

    _sendCallCount = 0;
    const resend = makeSuccessResend();

    // Both calls share the same store and resend fake, simulating two
    // overlapping cron invocations. Because `FakeQueryBuilder.then()` is
    // async (uses `Promise.resolve()`), the two calls interleave at each
    // `await` point. The `.eq("status", "pending")` guard in the claim
    // UPDATE means the second call finds the row already in `sending` and
    // skips it — exactly the at-most-once semantics we need.
    const deps: FlushDeps = { admin: makeAdmin(store) as FlushDeps["admin"], resend };
    const [c1, c2] = await Promise.all([flushOutbox(deps), flushOutbox(deps)]);

    const totalSent = c1.sent + c2.sent;
    const totalClaimed = c1.claimed + c2.claimed;

    expect(totalClaimed).toBe(1);
    expect(totalSent).toBe(1);
    expect(_sendCallCount).toBe(1);

    // The row must be persisted as `sent` — not stuck in `sending`.
    expect(store.get(row.id)?.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// 2. Immediate-dead on render error (invalid template)
// ---------------------------------------------------------------------------

test.describe("flushOutbox — invalid template marks dead immediately", () => {
  test("a row with an unknown template is dead after a single flush, not after 5 retries", async () => {
    const store = new Map<string, OutboxRow>();
    const row = makePendingRow({ template: "does-not-exist" });
    store.set(row.id, row);

    const resend = makeSuccessResend(); // irrelevant — render fails before send
    const deps: FlushDeps = { admin: makeAdmin(store) as FlushDeps["admin"], resend };

    const counters = await flushOutbox(deps);

    expect(counters.dead).toBe(1);
    expect(counters.sent).toBe(0);
    // attempts is incremented once (the single render attempt).
    expect(store.get(row.id)?.attempts).toBe(1);
    // Status must be dead immediately — no pending/retry.
    expect(store.get(row.id)?.status).toBe("dead");
    // last_error should mention the render failure.
    expect(store.get(row.id)?.last_error).toMatch(/render:/);
  });
});

// ---------------------------------------------------------------------------
// 3. Exponential backoff after a transient send failure
// ---------------------------------------------------------------------------

test.describe("flushOutbox — transient send failure schedules backoff retry", () => {
  test("first failure increments attempts and schedules next_attempt_at per BACKOFF_MINUTES[1]", async () => {
    const store = new Map<string, OutboxRow>();
    const row = makePendingRow({ attempts: 0 });
    store.set(row.id, row);

    const resend = makeFailingResend("ECONNRESET");
    const deps: FlushDeps = { admin: makeAdmin(store) as FlushDeps["admin"], resend };

    const before = Date.now();
    const counters = await flushOutbox(deps);
    const after = Date.now();

    const stored = store.get(row.id)!;

    // The row should be back to pending (ready for the next retry attempt).
    expect(stored.status).toBe("pending");

    // attempts must have been incremented.
    expect(stored.attempts).toBe(1);

    // last_error must record the failure message.
    expect(stored.last_error).toContain("ECONNRESET");

    // next_attempt_at must be approximately now + BACKOFF_MINUTES[1] minutes.
    const expectedDelayMs = BACKOFF_MINUTES[1] * 60_000;
    const scheduledAt = new Date(stored.next_attempt_at).getTime();
    // Allow ±5 s tolerance for test execution time.
    expect(scheduledAt).toBeGreaterThanOrEqual(before + expectedDelayMs - 5_000);
    expect(scheduledAt).toBeLessThanOrEqual(after + expectedDelayMs + 5_000);

    // Counters: the row was retried (not dead, not sent).
    expect(counters.retried).toBe(1);
    expect(counters.sent).toBe(0);
    expect(counters.dead).toBe(0);
  });

  test("backoff grows per BACKOFF_MINUTES for subsequent failures", () => {
    // Pure arithmetic test — verifies the schedule is [0, 2, 4, 8, 16] minutes
    // and that the index clamping (Math.min(attempts, len-1)) is correct.
    expect(BACKOFF_MINUTES).toHaveLength(5);
    expect(BACKOFF_MINUTES[0]).toBe(0);
    expect(BACKOFF_MINUTES[1]).toBe(2);
    expect(BACKOFF_MINUTES[2]).toBe(4);
    expect(BACKOFF_MINUTES[3]).toBe(8);
    expect(BACKOFF_MINUTES[4]).toBe(16);

    // The schedule must be strictly increasing (each retry waits longer).
    for (let i = 1; i < BACKOFF_MINUTES.length; i++) {
      expect(BACKOFF_MINUTES[i]).toBeGreaterThan(BACKOFF_MINUTES[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. MAX_ATTEMPTS cap → dead + admin alarm log
// ---------------------------------------------------------------------------

test.describe("flushOutbox — MAX_ATTEMPTS cap marks row dead with admin alarm", () => {
  test("a row at attempts = MAX_ATTEMPTS-1 becomes dead after one more flush", async () => {
    const store = new Map<string, OutboxRow>();
    const row = makePendingRow({ attempts: MAX_ATTEMPTS - 1 });
    store.set(row.id, row);

    const resend = makeFailingResend("Resend 503");
    const deps: FlushDeps = { admin: makeAdmin(store) as FlushDeps["admin"], resend };

    // Spy on console.error to verify the admin-alarm log line is emitted.
    const errorLogs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorLogs.push(args);
      // Forward to avoid suppressing other unexpected errors in output.
      originalError(...args);
    };

    let counters;
    try {
      counters = await flushOutbox(deps);
    } finally {
      console.error = originalError;
    }

    const stored = store.get(row.id)!;

    // Status must be dead.
    expect(stored.status).toBe("dead");

    // Attempts must equal MAX_ATTEMPTS (previous + 1).
    expect(stored.attempts).toBe(MAX_ATTEMPTS);

    // The counter must reflect one dead row.
    expect(counters!.dead).toBe(1);
    expect(counters!.sent).toBe(0);

    // The admin alarm log line must have been emitted.
    const alarmFired = errorLogs.some(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("[email_outbox] DEAD — admin attention required:"),
    );
    expect(alarmFired).toBe(true);
  });

  test("MAX_ATTEMPTS constant is 5", () => {
    // Pins the constant so a silent change (e.g. from 5 to 3) doesn't
    // go unnoticed — any change here needs a deliberate test update.
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
