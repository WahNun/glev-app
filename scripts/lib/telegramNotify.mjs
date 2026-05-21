/**
 * scripts/lib/telegramNotify.mjs
 *
 * Testable core of the notify-telegram.mjs round-trip.
 *
 * Exported so the integration test suite can inject a fake Supabase client
 * and directly exercise the subscription wiring (channel name, filter,
 * event type) and resolution logic without needing a live bot or DB.
 */

import { shouldResolveInbound } from './telegramResolve.mjs';

/**
 * Subscribes to Supabase Realtime for `inbound` replies on `taskId`.
 *
 * Wiring validated by tests:
 *   • Channel name : `agent_messages:<taskId>`
 *   • Event type   : `INSERT`
 *   • Schema       : `public`
 *   • Table        : `agent_messages`
 *   • Filter string: `task_id=eq.<taskId>`
 *   • Resolution   : `shouldResolveInbound(row, sentAt) !== null`
 *   • Timeout      : resolves `"TIMEOUT"` after `timeoutMs` ms
 *
 * @param {string} taskId      - Asana task GID used as the correlation key.
 * @param {string} sentAt      - ISO timestamp captured just before the outbound INSERT.
 * @param {object} supabase    - Supabase client (real or fake).
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=600000] - Safety timeout in milliseconds.
 * @returns {Promise<string>}  Resolves with the reply text or `"TIMEOUT"`.
 */
export function waitForReply(taskId, sentAt, supabase, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    let resolved = false;

    const channel = supabase
      .channel(`agent_messages:${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_messages',
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const answer = shouldResolveInbound(payload.new, sentAt);
          if (answer !== null && !resolved) {
            resolved = true;
            channel.unsubscribe();
            resolve(answer);
          }
        },
      )
      .subscribe();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        channel.unsubscribe();
        resolve('TIMEOUT');
      }
    }, timeoutMs);
  });
}
