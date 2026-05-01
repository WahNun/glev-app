// Unit coverage for the drip-status helpers in lib/emails/drip-status.ts.
//
// Why this exists:
//   The /admin/drip operator dashboard (Task #162) shows six counter
//   cards (today / tomorrow / next 7 days / sent 7d / sent total /
//   failed) plus a per-row status badge. Both consume the SAME
//   classifyRow + computeDripCounts helpers — if the bucket boundaries
//   drift (e.g. "tomorrow" silently includes today, or "failed" fires
//   on every row that's a few minutes late), the operator sees the
//   wrong picture and triages the wrong rows.
//
//   The most subtle bit is the FAILED_GRACE_HOURS = 24h window: an
//   overdue-by-3h row is still "due_today" (the cron only runs once
//   a day at 09:00 UTC, so 3h of slack is normal), while overdue-by-
//   25h is a real stuck row.

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
  };
}

test("classifyRow: sent_at takes precedence over everything else", () => {
  // Even an "overdue by a year" row counts as sent if sent_at is set —
  // the cron eventually delivered it.
  const r = row({
    scheduled_at: "2025-01-01T00:00:00Z",
    sent_at: "2025-01-02T00:00:00Z",
  });
  expect(classifyRow(r, NOW)).toBe("sent");
});

test("classifyRow: scheduled later today is due_today", () => {
  const r = row({ scheduled_at: "2026-05-01T18:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_today");
});

test("classifyRow: scheduled a few hours ago but not overdue is still due_today", () => {
  // 3 hours ago — well within the 24h grace window. The cron just
  // hasn't ticked yet (or is ticking right now).
  const r = row({ scheduled_at: "2026-05-01T09:00:00Z" });
  expect(classifyRow(r, NOW)).toBe("due_today");
});

test("classifyRow: scheduled tomorrow is due_tomorrow", () => {
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

test("classifyRow: overdue by exactly grace window edge stays non-failed", () => {
  // Exactly 24h overdue — the boundary is "> 24h", so 24h on the dot
  // is not yet failed. Anything more is.
  const exactly24hAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  const r = row({ scheduled_at: exactly24hAgo.toISOString() });
  expect(classifyRow(r, NOW)).not.toBe("failed");
});

test("classifyRow: overdue by 25h is failed", () => {
  const twentyFiveHoursAgo = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
  const r = row({ scheduled_at: twentyFiveHoursAgo.toISOString() });
  expect(classifyRow(r, NOW)).toBe("failed");
});

test("computeDripCounts: aggregates all six buckets correctly", () => {
  const rows: DripScheduleRow[] = [
    // Two due today (one earlier today, one later today)
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
    // Two failed — overdue by more than 24h, not sent
    row({ id: "9", scheduled_at: "2026-04-20T09:00:00Z" }),
    row({ id: "10", scheduled_at: "2026-04-25T09:00:00Z" }),
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
  // SQL counters and per-row badges MUST agree, otherwise the operator
  // sees "3 failed" in the card but only 2 red badges in the table.
  const w = dripBucketWindows(NOW);
  expect(w.nowIso).toBe("2026-05-01T12:00:00.000Z");
  expect(w.todayStartIso).toBe("2026-05-01T00:00:00.000Z");
  expect(w.tomorrowStartIso).toBe("2026-05-02T00:00:00.000Z");
  expect(w.dayAfterTomorrowStartIso).toBe("2026-05-03T00:00:00.000Z");
  // failed threshold is 24h ago
  expect(w.failedThresholdIso).toBe("2026-04-30T12:00:00.000Z");
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
