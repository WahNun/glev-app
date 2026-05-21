/**
 * scripts/lib/telegramResolve.mjs
 *
 * Pure helper shared between scripts/notify-telegram.mjs and the
 * integration test suite (tests/unit/telegramIntegration.test.ts).
 *
 * Keeping the resolution predicate here — instead of inlining it in both
 * places — ensures there is a single source of truth: if the condition
 * changes, only this file changes, and both the production script and the
 * tests automatically pick up the new logic.
 */

/**
 * Returns the inbound message text if `row` should resolve the waiting
 * notify-script promise, or `null` if the row should be ignored.
 *
 * A row resolves the promise when:
 *   1. direction === "inbound"   — it is a reply, not our own outbound question
 *   2. created_at >= sentAt      — it was created after (or at) the moment we
 *                                  sent the outbound message (ISO-string
 *                                  lexicographic comparison is intentional and
 *                                  correct for UTC timestamps)
 *
 * @param {object} row      - A Supabase `agent_messages` row from the Realtime payload.
 * @param {string} sentAt   - ISO timestamp captured just before the outbound INSERT.
 * @returns {string | null}
 */
export function shouldResolveInbound(row, sentAt) {
  if (row.direction === 'inbound' && row.created_at >= sentAt) {
    return row.message;
  }
  return null;
}
