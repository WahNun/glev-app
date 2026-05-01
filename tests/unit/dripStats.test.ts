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
  aggregateDailyDripSeries,
  DAILY_SERIES_DEFAULT_DAYS,
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

// --- aggregateDailyDripSeries ----------------------------------------

test("daily series returns one bucket per day for every drip type, oldest-first", () => {
  const series = aggregateDailyDripSeries([], [], NOW);
  for (const t of DRIP_TYPES) {
    expect(series[t]).toBeDefined();
    expect(series[t].length).toBe(DAILY_SERIES_DEFAULT_DAYS);
    // Oldest first: day[0] sorts before day[last] lexicographically
    // (YYYY-MM-DD strings compare correctly as plain text).
    expect(series[t][0].day < series[t][series[t].length - 1].day).toBe(true);
    // Every bucket starts at zero so a chart with no data renders an
    // empty axis instead of "undefined" gaps.
    for (const b of series[t]) {
      expect(b).toEqual({ day: b.day, sent: 0, unsubscribed: 0 });
    }
  }
});

test("daily series axis ends on the UTC day containing `now`", () => {
  const series = aggregateDailyDripSeries([], [], NOW);
  const lastDay = series.day7_insights[series.day7_insights.length - 1].day;
  expect(lastDay).toBe("2026-05-01");
  const firstDay = series.day7_insights[0].day;
  // 30-day window inclusive of today → first bucket is 29 days back.
  expect(firstDay).toBe("2026-04-02");
});

test("daily series buckets a sent mail on the UTC day of sent_at", () => {
  // Use a custom 7-day window to keep the assertion compact.
  const sent: SentRow[] = [
    {
      email: "x@x.de",
      email_type: "day7_insights",
      // 14:30 UTC → still 2026-04-29 in UTC, regardless of host TZ.
      sent_at: "2026-04-29T14:30:00Z",
    },
  ];
  const series = aggregateDailyDripSeries(sent, [], NOW, 7);
  const day7 = series.day7_insights;
  // Window is the trailing 7 days ending 2026-05-01 → 2026-04-25..05-01.
  expect(day7.map((b) => b.day)).toEqual([
    "2026-04-25",
    "2026-04-26",
    "2026-04-27",
    "2026-04-28",
    "2026-04-29",
    "2026-04-30",
    "2026-05-01",
  ]);
  const target = day7.find((b) => b.day === "2026-04-29")!;
  expect(target.sent).toBe(1);
  expect(target.unsubscribed).toBe(0);
});

test("daily series buckets opt-outs on the day they happened, not the send day", () => {
  // Mail goes out Friday, recipient unsubscribes the next Tuesday — the
  // chart should put the spike on Tuesday so an operator scanning for
  // "what changed on Tuesday" sees it.
  const sent: SentRow[] = [
    {
      email: "spike@x.de",
      email_type: "day14_feedback",
      sent_at: "2026-04-24T08:00:00Z", // Friday
    },
  ];
  const unsubs: UnsubRow[] = [
    { email: "spike@x.de", unsubscribed_at: "2026-04-28T09:30:00Z" }, // Tuesday
  ];
  const series = aggregateDailyDripSeries(sent, unsubs, NOW);
  const day14 = series.day14_feedback;
  const friday = day14.find((b) => b.day === "2026-04-24")!;
  const tuesday = day14.find((b) => b.day === "2026-04-28")!;
  expect(friday.sent).toBe(1);
  expect(friday.unsubscribed).toBe(0);
  expect(tuesday.sent).toBe(0);
  expect(tuesday.unsubscribed).toBe(1);
});

test("daily series ignores unsubscribes that happened before sent_at", () => {
  // Pre-existing unsubscribe — same defensive guard as the totals
  // aggregator. The sent row should still count, the opt-out should not
  // be attributed to this drip on any day.
  const sent: SentRow[] = [
    {
      email: "before@x.de",
      email_type: "day30_trustpilot",
      sent_at: "2026-04-20T10:00:00Z",
    },
  ];
  const unsubs: UnsubRow[] = [
    { email: "before@x.de", unsubscribed_at: "2026-04-10T10:00:00Z" },
  ];
  const series = aggregateDailyDripSeries(sent, unsubs, NOW);
  const totalUnsub = series.day30_trustpilot.reduce(
    (acc, b) => acc + b.unsubscribed,
    0,
  );
  const totalSent = series.day30_trustpilot.reduce((acc, b) => acc + b.sent, 0);
  expect(totalSent).toBe(1);
  expect(totalUnsub).toBe(0);
});

test("daily series drops events outside the trailing window", () => {
  const sent: SentRow[] = [
    // Inside the default 30-day window (~10 days ago).
    { email: "fresh@x.de", email_type: "day7_insights", sent_at: iso(10) },
    // 60 days ago — well outside the window.
    { email: "ancient@x.de", email_type: "day7_insights", sent_at: iso(60) },
  ];
  const series = aggregateDailyDripSeries(sent, [], NOW);
  const totalSent = series.day7_insights.reduce((acc, b) => acc + b.sent, 0);
  expect(totalSent).toBe(1);
});

test("daily series sent totals reconcile with aggregateDripStats.last30d", () => {
  // The chart and the table sit next to each other — if their numbers
  // disagreed an operator would lose trust in both. This test pins the
  // invariant: summing the chart's `sent` over the 30-day window must
  // equal the table's `last30d.sent` for every drip type.
  const sent: SentRow[] = [
    { email: "a@x.de", email_type: "day7_insights", sent_at: iso(2) },
    { email: "b@x.de", email_type: "day7_insights", sent_at: iso(20) },
    { email: "c@x.de", email_type: "day14_feedback", sent_at: iso(5) },
    { email: "d@x.de", email_type: "day30_trustpilot", sent_at: iso(15) },
    // outside window — neither side should count this
    { email: "e@x.de", email_type: "day30_trustpilot", sent_at: iso(60) },
  ];
  const unsubs: UnsubRow[] = [
    { email: "b@x.de", unsubscribed_at: iso(10) }, // after b's send → counts
    { email: "c@x.de", unsubscribed_at: iso(2) }, // after c's send → counts
  ];
  const totals = aggregateDripStats(sent, unsubs, NOW);
  const series = aggregateDailyDripSeries(sent, unsubs, NOW);
  for (const t of DRIP_TYPES) {
    const sumSent = series[t].reduce((acc, b) => acc + b.sent, 0);
    const sumUnsub = series[t].reduce((acc, b) => acc + b.unsubscribed, 0);
    const totalRow = totals.find((s) => s.type === t)!;
    expect(sumSent).toBe(totalRow.last30d.sent);
    expect(sumUnsub).toBe(totalRow.last30d.unsubscribed);
  }
});
