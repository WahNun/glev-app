// Durable email outbox — see migration 20260501_add_email_outbox.sql for
// the table contract and lifecycle.
//
// Two entry points live here:
//
//   enqueueEmail()  — called from request handlers (e.g. the Stripe
//                     webhook) instead of resend.emails.send(). Insert
//                     is the *only* synchronous work the request does;
//                     the actual SMTP call happens asynchronously in the
//                     cron worker, so a Resend outage no longer drops
//                     the buyer's welcome mail on the floor.
//
//   flushOutbox()   — called from the cron route. Picks up `pending`
//                     rows whose `next_attempt_at` is due, atomically
//                     claims them ("sending"), renders + sends via
//                     Resend, and either marks them `sent` or schedules
//                     the next retry (exponential backoff up to 5
//                     attempts; then `dead` + loud admin alarm log).

import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { betaWelcomeHtml, betaWelcomeSubject } from "@/lib/emails/beta-welcome";

// ---- Tunables -------------------------------------------------------------

/**
 * Max number of attempts before a row is moved to `dead` and stops
 * being retried. Spec ("bis 5x") — counted as 1 initial + 4 retries
 * OR 5 retries depending on reading. We use "up to 5 attempts total"
 * which is the stricter, safer interpretation of "bis 5x".
 */
export const MAX_ATTEMPTS = 5;

/**
 * Backoff schedule in *minutes* after each failed attempt. Index
 * matches the new `attempts` value after the failure (i.e. after the
 * 1st failure → wait BACKOFF_MINUTES[1] = 2 min before next try). The
 * 0th slot is unused (initial enqueue uses next_attempt_at = now()).
 *
 * 2 → 4 → 8 → 16 minutes — fits inside the cron-every-1-2-min cadence
 * without being so aggressive that a flaky Resend gets hammered.
 */
const BACKOFF_MINUTES = [0, 2, 4, 8, 16];

/**
 * Max rows processed per cron invocation. Keeps the request-bound
 * worker from getting OOM-killed on a very full backlog and bounds
 * the time the cron handler holds the connection open.
 */
const FLUSH_BATCH_SIZE = 25;

/**
 * If a row sits in `sending` for longer than this, assume the worker
 * that claimed it crashed (or its DB-finalize write was lost) and
 * reclaim the row back to `pending` so the next cron invocation
 * retries it. This is the safety net that keeps "Webhook-Mails kommen
 * auch nach Server-Crash zuverlässig an" actually true: without it,
 * a process death between claim and the post-send mark would orphan
 * the row forever.
 *
 * 10 minutes is generous enough that a slow Resend send + the
 * post-send DB-write retry loop below (~20s worst case) finishes
 * well before reclaim, so we never reclaim a row that is actually
 * being processed by a healthy worker.
 *
 * Trade-off: if a worker DOES successfully call Resend but then
 * crashes before writing `sent`, reclaim re-sends → duplicate email.
 * That is the at-least-once guarantee the spec wants ("Mail kommt
 * zuverlässig an"); a duplicate is preferable to a silent drop.
 */
const STUCK_CLAIM_TIMEOUT_MS = 10 * 60_000;

/**
 * How many times we retry the *DB write* that finalises a row's state
 * after Resend has responded. Resend has already accepted (or
 * rejected) the message; we just need to record the outcome durably.
 * If even these retries fail, the stuck-claim reclaim above is the
 * last line of defence.
 */
const FINALIZE_RETRIES = 3;
const FINALIZE_RETRY_DELAY_MS = 250;

// ---- Templates ------------------------------------------------------------

/**
 * Whitelist of supported template names. Exhaustive switch in
 * `renderTemplate()` below means TS will fail the build if a new
 * template is added but the renderer isn't updated.
 */
export type EmailTemplate = "beta-welcome";

/**
 * Payload shape per template. Stored as jsonb in the outbox so the
 * cron worker can re-render even after a deploy that changes the
 * email HTML.
 */
export interface BetaWelcomePayload {
  name?: string | null;
  sessionId?: string | null;
  appUrl?: string | null;
}

export type EmailPayload = BetaWelcomePayload;

interface RenderedEmail {
  from: string;
  subject: string;
  html: string;
}

function renderTemplate(template: EmailTemplate, payload: EmailPayload): RenderedEmail {
  switch (template) {
    case "beta-welcome": {
      const p = payload as BetaWelcomePayload;
      return {
        from: "Glev <info@glev.app>",
        subject: betaWelcomeSubject(p.name ?? null),
        html: betaWelcomeHtml(p.name ?? null, p.sessionId ?? null, p.appUrl ?? null),
      };
    }
    default: {
      // Compile-time check: if a new template is added to the union
      // and not handled above, this assignment will fail TS.
      const _exhaustive: never = template;
      throw new Error(`Unknown email template: ${String(_exhaustive)}`);
    }
  }
}

// ---- Resend client (lazy) -------------------------------------------------

let _resend: Resend | null = null;

function getResend(): Resend {
  // Lazy: constructing Resend at module load with a malformed key
  // throws synchronously, which would 500 every cron invocation.
  // Defer to first send so the row stays `pending` and gets retried
  // after the operator fixes RESEND_API_KEY.
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ---- Public API -----------------------------------------------------------

/**
 * Enqueue an email for asynchronous delivery.
 *
 * Returns the outbox row id (useful for log correlation) or throws on
 * insert failure — the *caller* must decide what to do about that.
 *
 * For Stripe webhooks specifically: the caller MUST propagate the
 * failure back to Stripe with a non-2xx response, otherwise the
 * delivery guarantee collapses (paid customer + no welcome mail +
 * Stripe ack'd → no retry). The `dedupeKey` parameter is what makes
 * that retry safe: a second webhook delivery for the same Stripe
 * session id will hit the partial-unique index on
 * (template, dedupe_key) and short-circuit to the existing row id
 * instead of creating a duplicate mail.
 *
 * Returns `{ id, deduplicated }`. `deduplicated: true` means an
 * existing row was returned because the dedupe key matched — the
 * caller usually doesn't need to care, but it's exposed for logs.
 */
export async function enqueueEmail(args: {
  recipient: string;
  template: EmailTemplate;
  payload: EmailPayload;
  /**
   * Per-(template) idempotency key. Strongly recommended for any
   * caller wired to a system that retries the same logical event
   * (Stripe webhooks, GitHub webhooks, polled APIs). Pass the
   * upstream event's natural id (Stripe session id, event id, etc.).
   */
  dedupeKey?: string;
}): Promise<{ id: string; deduplicated: boolean }> {
  const admin = getSupabaseAdmin();

  // Fast path when no dedupe is requested: plain insert, no extra
  // round-trips. Callers that opt out of dedupe knowingly accept
  // the duplicate-on-retry risk.
  if (!args.dedupeKey) {
    const { data, error } = await admin
      .from("email_outbox")
      .insert({
        recipient: args.recipient,
        template: args.template,
        payload: args.payload as Record<string, unknown>,
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        `[email_outbox] enqueue failed: ${error?.message ?? "no row returned"}`,
      );
    }
    return { id: data.id as string, deduplicated: false };
  }

  // Dedupe path: try to insert, on unique-violation (PG 23505 from
  // the partial unique index) read the existing row and return its
  // id. We deliberately do NOT use upsert here — upsert would
  // *update* the existing row's payload/status, which could (a) reset
  // a `dead` row back to `pending` and (b) clobber the original
  // recipient/payload of an already-enqueued mail. The conservative
  // "first writer wins" semantics fit the idempotency contract
  // better.
  const { data: inserted, error: insertErr } = await admin
    .from("email_outbox")
    .insert({
      recipient: args.recipient,
      template: args.template,
      payload: args.payload as Record<string, unknown>,
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      dedupe_key: args.dedupeKey,
    })
    .select("id")
    .single();

  if (!insertErr && inserted) {
    return { id: inserted.id as string, deduplicated: false };
  }

  // PostgREST surfaces the underlying Postgres SQLSTATE as `code`.
  // 23505 is unique_violation. Anything else is a real failure.
  if (insertErr && insertErr.code === "23505") {
    const { data: existing, error: lookupErr } = await admin
      .from("email_outbox")
      .select("id")
      .eq("template", args.template)
      .eq("dedupe_key", args.dedupeKey)
      .single();
    if (lookupErr || !existing) {
      throw new Error(
        `[email_outbox] dedupe lookup after unique-violation failed: ` +
          `${lookupErr?.message ?? "no row found"}`,
      );
    }
    return { id: existing.id as string, deduplicated: true };
  }

  throw new Error(
    `[email_outbox] enqueue failed: ${insertErr?.message ?? "no row returned"}`,
  );
}

interface FlushResult {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  errors: number;
}

/**
 * Process up to FLUSH_BATCH_SIZE due `pending` rows.
 *
 * Concurrency model:
 *   1. Select due ids in a small batch (no FOR UPDATE — supabase-js has
 *      no easy way to expose row locks — so we instead do a guarded
 *      UPDATE that atomically flips status `pending → sending` and
 *      bumps `last_attempt_at`. The .eq("status","pending") guard
 *      prevents a second worker from claiming the same row.
 *   2. Send via Resend.
 *   3. Mark `sent` on success, or compute next backoff and write
 *      `pending` (with attempts++) — unless attempts hit MAX_ATTEMPTS,
 *      then `dead` + loud admin log.
 *
 * Returns a counters object for the cron handler to log.
 */
export async function flushOutbox(): Promise<FlushResult> {
  const admin = getSupabaseAdmin();
  const counters: FlushResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    dead: 0,
    errors: 0,
  };

  // 0. Reclaim stuck claims FIRST. Any row sitting in `sending` for
  //    longer than STUCK_CLAIM_TIMEOUT_MS belongs to a worker that
  //    crashed (or whose finalize-write was lost). Flip them back to
  //    `pending` with next_attempt_at = now so the loop below picks
  //    them up immediately. We do NOT increment `attempts` here — the
  //    previous attempt's outcome is unknown, and double-counting it
  //    would push borderline rows into `dead` for a fault that wasn't
  //    really their failure.
  const reclaimCutoffIso = new Date(Date.now() - STUCK_CLAIM_TIMEOUT_MS).toISOString();
  const { data: reclaimed, error: reclaimErr } = await admin
    .from("email_outbox")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      last_error: "reclaimed: previous worker did not finalize",
    })
    .eq("status", "sending")
    .lt("last_attempt_at", reclaimCutoffIso)
    .select("id");
  if (reclaimErr) {
    // eslint-disable-next-line no-console
    console.error("[email_outbox] reclaim failed:", reclaimErr);
    // Do not throw — proceed with the rest of the flush; reclaim is
    // idempotent and will retry next tick.
  } else if (reclaimed && reclaimed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("[email_outbox] reclaimed stuck rows:", {
      count: reclaimed.length,
      ids: reclaimed.map((r) => r.id),
    });
  }

  // 1. Find due rows (id-only — full row is re-read after the claim).
  const nowIso = new Date().toISOString();
  const { data: dueRows, error: selectErr } = await admin
    .from("email_outbox")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(FLUSH_BATCH_SIZE);

  if (selectErr) {
    // eslint-disable-next-line no-console
    console.error("[email_outbox] flush — select failed:", selectErr);
    throw new Error(`flush select failed: ${selectErr.message}`);
  }
  if (!dueRows || dueRows.length === 0) return counters;

  for (const { id } of dueRows) {
    // 2. Atomic claim: only succeeds if the row is still `pending`.
    const claimAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("email_outbox")
      .update({ status: "sending", last_attempt_at: claimAt })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, recipient, template, payload, attempts")
      .single();

    if (claimErr || !claimed) {
      // Either another worker stole it (PGRST116 "no rows") or the
      // update itself failed. Either way, skip — counters.errors only
      // tracks "tried to send + failed unexpectedly".
      continue;
    }
    counters.claimed += 1;

    // 3. Render + send.
    const attemptsAfter = (claimed.attempts as number) + 1;
    let rendered: RenderedEmail;
    try {
      rendered = renderTemplate(
        claimed.template as EmailTemplate,
        (claimed.payload ?? {}) as EmailPayload,
      );
    } catch (err) {
      // Template renderer threw — usually a programming error (bad
      // template name or bad payload shape). Mark `dead` immediately;
      // retries can't fix a bad template.
      const message = err instanceof Error ? err.message : String(err);
      const ok = await markDead(id as string, `render: ${message}`, attemptsAfter);
      if (ok) counters.dead += 1;
      counters.errors += 1;
      continue;
    }

    let sendError: string | null = null;
    let messageId: string | null = null;
    try {
      const resend = getResend();
      const { data, error } = await resend.emails.send({
        from: rendered.from,
        to: claimed.recipient as string,
        subject: rendered.subject,
        html: rendered.html,
      });
      if (error) {
        sendError = `${error.name ?? "ResendError"}: ${error.message ?? "unknown"}`;
      } else if (data?.id) {
        messageId = data.id;
      } else {
        sendError = "Resend returned neither data nor error";
      }
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
    }

    if (!sendError) {
      // Success — record durably. We retry the DB write because at
      // this point Resend has already accepted the message; failing
      // to mark `sent` would let the stuck-claim reclaim re-send it
      // later, which costs us a duplicate user mail. Best to spin a
      // few times on a transient DB hiccup before giving up to the
      // reclaimer.
      const sentAt = new Date().toISOString();
      const finalized = await finalizeWithRetry(admin, id as string, {
        status: "sent",
        attempts: attemptsAfter,
        sent_at: sentAt,
        message_id: messageId,
        last_error: null,
      });
      if (!finalized) {
        // eslint-disable-next-line no-console
        console.error("[email_outbox] mark-sent FAILED after retries — row left in `sending`, will be reclaimed:", {
          id,
          to: claimed.recipient,
          messageId,
        });
        counters.errors += 1;
      } else {
        // eslint-disable-next-line no-console
        console.log("[email_outbox] sent:", {
          id,
          to: claimed.recipient,
          template: claimed.template,
          attempts: attemptsAfter,
          messageId,
        });
        counters.sent += 1;
      }
      continue;
    }

    // Failure path.
    if (attemptsAfter >= MAX_ATTEMPTS) {
      const ok = await markDead(id as string, sendError, attemptsAfter, claimed.recipient as string);
      if (ok) {
        counters.dead += 1;
      } else {
        // mark-dead persistently failed — leave the row in `sending`
        // so reclaim resurrects it; better than silently losing the
        // alarm signal.
      }
      counters.errors += 1;
    } else {
      const backoffMin =
        BACKOFF_MINUTES[Math.min(attemptsAfter, BACKOFF_MINUTES.length - 1)];
      const next = new Date(Date.now() + backoffMin * 60_000).toISOString();
      const finalized = await finalizeWithRetry(admin, id as string, {
        status: "pending",
        attempts: attemptsAfter,
        last_error: sendError.slice(0, 2000),
        next_attempt_at: next,
      });
      if (!finalized) {
        // eslint-disable-next-line no-console
        console.error("[email_outbox] reschedule FAILED after retries — row left in `sending`, will be reclaimed:", {
          id,
          to: claimed.recipient,
        });
        counters.errors += 1;
      } else {
        // eslint-disable-next-line no-console
        console.warn("[email_outbox] retry scheduled:", {
          id,
          to: claimed.recipient,
          attempts: attemptsAfter,
          nextAttemptAt: next,
          err: sendError,
        });
        counters.retried += 1;
        counters.errors += 1;
      }
    }
  }

  return counters;
}

/**
 * Try the finalising UPDATE up to FINALIZE_RETRIES times before giving
 * up. Returns true on success, false if every attempt failed (in which
 * case the row stays `sending` and the next flushOutbox call will
 * reclaim it via STUCK_CLAIM_TIMEOUT_MS).
 */
async function finalizeWithRetry(
  admin: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  for (let i = 0; i < FINALIZE_RETRIES; i++) {
    const { error } = await admin.from("email_outbox").update(patch).eq("id", id);
    if (!error) return true;
    // eslint-disable-next-line no-console
    console.warn("[email_outbox] finalize attempt failed, retrying:", {
      id,
      attempt: i + 1,
      err: error.message,
    });
    if (i < FINALIZE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, FINALIZE_RETRY_DELAY_MS * (i + 1)));
    }
  }
  return false;
}

async function markDead(
  id: string,
  err: string,
  attempts: number,
  recipient?: string,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const ok = await finalizeWithRetry(admin, id, {
    status: "dead",
    attempts,
    last_error: err.slice(0, 2000),
  });
  // ALARM — this is the operator-page line. Keep at error so it shows
  // up in any log-based alerting on `level=error`. Logged regardless of
  // the DB write outcome so the operator hears about it even if the
  // row didn't get persisted (and reclaim retries the send).
  // eslint-disable-next-line no-console
  console.error("[email_outbox] DEAD — admin attention required:", {
    id,
    recipient,
    attempts,
    lastError: err,
    persisted: ok,
  });
  return ok;
}
