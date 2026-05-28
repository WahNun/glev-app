// Unit coverage for the drip-status helpers in lib/emails/drip-status.ts.
//
// Why this exists:
//   The /admin/drip operator dashboard shows six counter cards (today /
//   tomorrow / next 7 days / sent 7d / sent total / failed) plus a per-row
//   status badge. Both consume the SAME classifyRow + computeDripCounts
//   helpers — if the bucket boundaries drift the operator sees the wrong
//   picture and triages the wrong rows.
//
//   As of Task #166, "failed" is driven by `last_error IS NOT NULL` (real
//   Resend error persisted by the cron), NOT by a time-heuristic. A row
//   that is overdue but has no last_error is still "due_today" — the cron
//   just hasn't ticked yet.

import { test, expect } from "@playwright/test";

import {
  classifyRow,
  computeDripCounts,
  dripBucketWindows,
  statusLabel,
  type DripScheduleRow,
} from "@/lib/emails/drip-status";

const NOW = new Date("2026-05-01T12:00:00Z");

function row(partial: Partial<DripScheduleRow>): DripScheduleRow {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000000",
    email: partial.email ?? "test@example.com",
    first_name: partial.first_name ?? null,
    tier: partial.tier ?? "beta",
    email_type: partial.email_type ?? "day7_insights",
    scheduled_at: partial.scheduled_at ?? NOW.toISOString(),
    sent_at: partial.sent_at ?? null,
    created_at: partial.created_at ?? NOW.toISOString(),
    last_attempt_at: partial.last_attempt_at ?? null,
    last_error: partial.last_error ?? null,
    attempt_count: partial.attempt_count ?? 0,
  };
}

test("classifyRow: sent_at takes precedence over everything else", () => {
  // Even a row with a last_error counts as sent if sent_at is set —
  // the cron eventually delivered it (last_error was cleared on success,
  // but even if somehow both were set, sent wins).
  const r = row({
    scheduled_at: "2025-01-01T00:00:00Z",
    sent_at: "2025-01-02T00:00:00Z",
  });
  expect(classifyRow(r, NOW)).toBe("sent");
});

test("classifyRow: last_error makes a row failed regardless of timing", () => {
  // Row scheduled for tomorrow, but Resend already returned an error.
  const r = row({
    scheduled_at: "2026-05-02T09:00:00Z",
    last_error: "ResendError: domain not verified",
  });
  expect(classifyRow(r, NOW)).toBe("failed");
});

test("classifyRow: overdue row WITHOUT last_error is still due_today (cron not yet ticked)", () => {
  // 25h overdue but no error recorded → cron just hasn't ticked yet.
  // Should NOT be "failed" without an actual Resend error.
  const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
  const r = row({ scheduled_at: twentyFiveHoursAgo.toISOString() });
  expect(classifyRow(r, NOW)).not.toBe("failed");
  expect(classifyRow(r, NOW)).toBe("due_today");
});

test("classifyRow: scheduled later today is due_today", () => {
  const r = row({ scheduled_at: "2026-05-01T18:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_today");
});

test("classifyRow: scheduled a few hours ago (no error) is still due_today", () => {
  const r = row({ scheduled_at: "2026-05-01T09:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_today");
});

test("classifyRow: scheduled tomorrow (no error) is due_tomorrow", () => {
  const r = row({ scheduled_at: "2026-05-02T09:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_tomorrow");
});

test("classifyRow: scheduled in 5 days is due_this_week", () => {
  const r = row({ scheduled_at: "2026-05-06T09:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_this_week");
});

test("classifyRow: scheduled in 10 days is scheduled_later", () => {
  const r = row({ scheduled_at: "2026-05-11T09:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("scheduled_later");
});

test("computeDripCounts: aggregates all six buckets correctly", () => {
  const rows: DripScheduleRow[] = [
    // Two due today (one earlier today, one later today — no errors)
    row({ id: "1", scheduled_at: "2026-05-01T11:00:00Z" }),
    row({ id: "2", scheduled_at: "2026-05-01T20:00:00Z" }),
    // One due tomorrow
    row({ id: "3", scheduled_at: "2026-05-02T09:00:00Z" }),
    // One due this week
    row({ id: "4", scheduled_at: "2026-05-05T09:00:00Z" }),
    // One scheduled later (NOT counted in any bucket)
    row({ id: "5", scheduled_at: "2026-06-01T09:00:00Z" }),
    // Three sent — two within last 7 days, one older
    row({
      id: "6",
      scheduled_at: "2026-04-20T09:00:00Z",
      sent_at: "2026-04-28T09:00:00Z",
    }),
    row({
      id: "7",
      scheduled_at: "2026-04-15T09:00:00Z",
      sent_at: "2026-04-30T09:00:00Z",
    }),
    row({
      id: "8",
      scheduled_at: "2026-01-01T09:00:00Z",
      sent_at: "2026-01-08T09:00:00Z",
    }),
    // Two failed — last_error set by the cron
    row({ id: "9", scheduled_at: "2026-04-20T09:00:00Z", last_error: "ResendError: domain not verified" }),
    row({ id: "10", scheduled_at: "2026-04-25T09:00:00Z", last_error: "ResendError: invalid recipient" }),
  ];

  const c = computeDripCounts(rows, NOW);
  expect(c.dueToday).toBe(2);
  expect(c.dueTomorrow).toBe(1);
  expect(c.dueThisWeek).toBe(1);
  expect(c.sentTotal).toBe(3);
  expect(c.sentLast7Days).toBe(2);
  expect(c.failed).toBe(2);
});

test("dripBucketWindows: produces consistent ISO boundaries for SQL filters", () => {
  // The page uses these ISO strings as Supabase filter values for the
  // six counter cards. Same boundaries also drive classifyRow above —
  // SQL counters and per-row badges MUST agree.
  const w = dripBucketWindows(NOW);
  expect(w.nowIso).toBe("2026-05-01T12:00:00.000Z");
  expect(w.todayStartIso).toBe("2026-05-01T00:00:00.000Z");
  expect(w.tomorrowStartIso).toBe("2026-05-02T00:00:00.000Z");
  expect(w.dayAfterTomorrowStartIso).toBe("2026-05-03T00:00:00.000Z");
  // sevenDaysAgo is exactly 7 days ago
  expect(w.sevenDaysAgoIso).toBe("2026-04-24T12:00:00.000Z");
  // 7 days from now (used as exclusive upper bound for "diese Woche")
  expect(w.weekFromNowIso).toBe("2026-05-08T12:00:00.000Z");
});

test("statusLabel: every status has a German label", () => {
  expect(statusLabel("sent")).toBe("Versendet");
  expect(statusLabel("due_today")).toBe("Heute fällig");
  expect(statusLabel("due_tomorrow")).toBe("Morgen fällig");
  expect(statusLabel("due_this_week")).toBe("Diese Woche");
  expect(statusLabel("scheduled_later")).toBe("Später geplant");
  expect(statusLabel("failed")).toBe("Fehlgeschlagen");
});
