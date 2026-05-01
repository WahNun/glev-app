// Unit coverage for the drip-stats aggregator that powers
// app/admin/drip-stats/page.tsx.
//
// The page itself is just a presentation layer over
// aggregateDripStats() — these tests pin the parts that are easy to
// get subtly wrong: the "unsubscribed AFTER sent_at" rule, the 7d/30d
// window cutoffs, and the rate formatter's empty-denominator behavior.

import { test, expect } from "@playwright/test";

import {
  aggregateDripStats,
  formatRate,
  DRIP_TYPES,
  DRIP_TYPE_LABEL,
  type SentRow,
  type UnsubRow,
} from "@/lib/emails/drip-stats";

const NOW = Date.parse("2026-05-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function iso(offsetDays: number): string {
  return new Date(NOW - offsetDays * DAY).toISOString();
}

test("aggregator returns one row per drip type, in canonical order", () => {
  const stats = aggregateDripStats([], [], NOW);
  expect(stats.map((s) => s.type)).toEqual([
    "day7_insights",
    "day14_feedback",
    "day30_trustpilot",
  ]);
  for (const s of stats) {
    expect(s.total).toEqual({ sent: 0, unsubscribed: 0 });
    expect(s.last7d).toEqual({ sent: 0, unsubscribed: 0 });
    expect(s.last30d).toEqual({ sent: 0, unsubscribed: 0 });
  }
});

test("counts a sent mail, with no unsubscribe", () => {
  const sent: SentRow[] = [
    { email: "a@x.de", email_type: "day7_insights", sent_at: iso(2) },
  ];
  const stats = aggregateDripStats(sent, [], NOW);
  const day7 = stats.find((s) => s.type === "day7_insights")!;
  expect(day7.total).toEqual({ sent: 1, unsubscribed: 0 });
  expect(day7.last7d).toEqual({ sent: 1, unsubscribed: 0 });
  expect(day7.last30d).toEqual({ sent: 1, unsubscribed: 0 });
});

test("only counts unsubscribes that happened on or after sent_at", () => {
  const sent: SentRow[] = [
    // mail sent 2 days ago
    { email: "after@x.de", email_type: "day14_feedback", sent_at: iso(2) },
    // mail sent 5 days ago to someone who unsubscribed BEFORE — should not
    // be attributed to this drip. (In practice the cron skips them, this
    // is the defensive guard.)
    { email: "before@x.de", email_type: "day14_feedback", sent_at: iso(5) },
  ];
  const unsubs: UnsubRow[] = [
    { email: "after@x.de", unsubscribed_at: iso(1) }, // after the send
    { email: "before@x.de", unsubscribed_at: iso(10) }, // before the send
  ];
  const stats = aggregateDripStats(sent, unsubs, NOW);
  const day14 = stats.find((s) => s.type === "day14_feedback")!;
  expect(day14.total.sent).toBe(2);
  expect(day14.total.unsubscribed).toBe(1);
});

test("buckets respect the 7-day and 30-day windows independently", () => {
  const sent: SentRow[] = [
    { email: "fresh@x.de", email_type: "day30_trustpilot", sent_at: iso(3) }, // in 7d
    { email: "midweek@x.de", email_type: "day30_trustpilot", sent_at: iso(15) }, // in 30d only
    { email: "oldie@x.de", email_type: "day30_trustpilot", sent_at: iso(60) }, // outside both
  ];
  const unsubs: UnsubRow[] = [
    { email: "fresh@x.de", unsubscribed_at: iso(2) }, // counts in 7d & 30d
    { email: "midweek@x.de", unsubscribed_at: iso(10) }, // counts in 30d only
    { email: "oldie@x.de", unsubscribed_at: iso(45) }, // counts only in total
  ];
  const stats = aggregateDripStats(sent, unsubs, NOW);
  const d30 = stats.find((s) => s.type === "day30_trustpilot")!;
  expect(d30.total).toEqual({ sent: 3, unsubscribed: 3 });
  expect(d30.last30d).toEqual({ sent: 2, unsubscribed: 2 });
  expect(d30.last7d).toEqual({ sent: 1, unsubscribed: 1 });
});

test("ignores rows with null/invalid sent_at and unknown email types", () => {
  const sent = [
    { email: "ok@x.de", email_type: "day7_insights", sent_at: iso(1) },
    // null sent_at — defensively tolerated even though the page filters
    // these out at the SQL layer
    { email: "skip@x.de", email_type: "day7_insights", sent_at: null as unknown as string },
    // unknown drip type — drop silently rather than crash
    { email: "weird@x.de", email_type: "day99_madeup" as never, sent_at: iso(1) },
  ] as SentRow[];
  const stats = aggregateDripStats(sent, [], NOW);
  const day7 = stats.find((s) => s.type === "day7_insights")!;
  expect(day7.total.sent).toBe(1);
});

test("formatRate returns dash for zero sent, one decimal otherwise", () => {
  expect(formatRate(0, 0)).toBe("—");
  expect(formatRate(0, 5)).toBe("—"); // defensive: nothing sent ⇒ no rate
  expect(formatRate(100, 1)).toBe("1.0%");
  expect(formatRate(1000, 14)).toBe("1.4%");
  expect(formatRate(3, 1)).toBe("33.3%");
});

test("DRIP_TYPE_LABEL covers every DRIP_TYPES entry", () => {
  for (const t of DRIP_TYPES) {
    expect(DRIP_TYPE_LABEL[t]).toBeTruthy();
  }
});
