// Aggregations for the admin drip-stats page (app/admin/drip-stats).
//
// Pure helpers — no Supabase, no Next.js — so they can be unit-tested
// in isolation. The page fetches raw rows from email_drip_schedule and
// email_drip_unsubscribes and then hands them to aggregateDripStats()
// to produce the per-drip-type totals + 7/30-day windows.
//
// Why "after sent_at" matters for the unsubscribe count:
//   The unsubscribe footer landed in Task #161. From the cron's point
//   of view, an unsubscribed recipient is filtered out *before* a drip
//   would have been sent (drip-scheduler.ts skips them at insert time,
//   and the cron also skips at send time). So if we counted *every*
//   unsubscribe joined by email — including ones that happened before
//   the mail went out — we'd double-attribute the same opt-out across
//   multiple drip types.  Counting only `unsubscribed_at >= sent_at`
//   ensures each drip gets credit exclusively for opt-outs it plausibly
//   triggered.

import type { DripEmailType } from "@/lib/emails/drip-templates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** All drip types, in the order we present them in the UI. */
export const DRIP_TYPES: ReadonlyArray<DripEmailType> = [
  "day7_insights",
  "day14_feedback",
  "day30_trustpilot",
];

export interface SentRow {
  email: string;
  email_type: DripEmailType;
  /** ISO timestamp; rows with `sent_at IS NULL` must be filtered before. */
  sent_at: string;
}

export interface UnsubRow {
  email: string;
  /** ISO timestamp. */
  unsubscribed_at: string;
}

export interface WindowStats {
  sent: number;
  unsubscribed: number;
}

export interface DripTypeStats {
  type: DripEmailType;
  total: WindowStats;
  last7d: WindowStats;
  last30d: WindowStats;
}

/**
 * Build per-drip-type sent/unsubscribe counters.
 *
 * @param sent  Rows from `email_drip_schedule` with non-null `sent_at`.
 *              Rows with null `sent_at` are tolerated (they are simply
 *              ignored) so callers may pass an unfiltered slice without
 *              risking off-by-one.
 * @param unsubs Rows from `email_drip_unsubscribes`.
 * @param now  Reference "now" timestamp; injected for deterministic
 *             tests. Defaults to `Date.now()` in production.
 */
export function aggregateDripStats(
  sent: ReadonlyArray<SentRow>,
  unsubs: ReadonlyArray<UnsubRow>,
  now: number = Date.now(),
): DripTypeStats[] {
  // Build email -> earliest unsubscribe timestamp. We use the earliest
  // because a single email column is the primary key in
  // email_drip_unsubscribes, so in practice there is exactly one row,
  // but the helper stays robust if a future migration relaxes that.
  const unsubByEmail = new Map<string, number>();
  for (const u of unsubs) {
    if (!u.email) continue;
    const ts = Date.parse(u.unsubscribed_at);
    if (!Number.isFinite(ts)) continue;
    const prev = unsubByEmail.get(u.email);
    if (prev === undefined || ts < prev) unsubByEmail.set(u.email, ts);
  }

  const cutoff7 = now - 7 * DAY_MS;
  const cutoff30 = now - 30 * DAY_MS;

  const stats = new Map<DripEmailType, DripTypeStats>();
  for (const t of DRIP_TYPES) {
    stats.set(t, {
      type: t,
      total: { sent: 0, unsubscribed: 0 },
      last7d: { sent: 0, unsubscribed: 0 },
      last30d: { sent: 0, unsubscribed: 0 },
    });
  }

  for (const row of sent) {
    if (!row.sent_at) continue;
    const bucket = stats.get(row.email_type);
    if (!bucket) continue; // unknown type — skip rather than crash

    const sentAt = Date.parse(row.sent_at);
    if (!Number.isFinite(sentAt)) continue;

    const unsubAt = unsubByEmail.get(row.email);
    // Counts as "after this drip" only if the opt-out happened on or
    // after the send timestamp. Pre-existing unsubs are ignored — the
    // cron skips those before sending, so they should not even appear
    // here, but the guard keeps the math honest if they ever do.
    const wasUnsubAfter = unsubAt !== undefined && unsubAt >= sentAt;

    bucket.total.sent += 1;
    if (wasUnsubAfter) bucket.total.unsubscribed += 1;

    if (sentAt >= cutoff30) {
      bucket.last30d.sent += 1;
      if (wasUnsubAfter && unsubAt! >= cutoff30) {
        bucket.last30d.unsubscribed += 1;
      }
    }
    if (sentAt >= cutoff7) {
      bucket.last7d.sent += 1;
      if (wasUnsubAfter && unsubAt! >= cutoff7) {
        bucket.last7d.unsubscribed += 1;
      }
    }
  }

  return DRIP_TYPES.map((t) => stats.get(t)!);
}

/**
 * Pretty rate ("1.4%") with deterministic formatting. Returns "—" when
 * the denominator is zero so the UI doesn't render "NaN%" or "0.0%"
 * (the latter would falsely suggest "we sent some, none unsubscribed").
 */
export function formatRate(sent: number, unsubscribed: number): string {
  if (!sent) return "—";
  const pct = (unsubscribed / sent) * 100;
  // One decimal — drip volume is small, two decimals would over-promise
  // precision and one decimal still distinguishes 0.5% from 1.4%.
  return `${pct.toFixed(1)}%`;
}

/** German labels for the drip types — matches the template subjects. */
export const DRIP_TYPE_LABEL: Record<DripEmailType, string> = {
  day7_insights: "Tag 7 — Insights",
  day14_feedback: "Tag 14 — Feedback",
  day30_trustpilot: "Tag 30 — Trustpilot",
};
