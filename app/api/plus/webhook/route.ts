import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripeServer";
import { extractFullNameFromSession } from "@/lib/stripeCheckout";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enqueueEmail } from "@/lib/emails/outbox";
import { scheduleDripEmails } from "@/lib/emails/drip-scheduler";
import {
  mapStripeStatus,
  mapStripeStatusToPlan,
  isPlusPriceId,
} from "@/lib/stripeWebhookHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Private helpers ──────────────────────────────────────────────────────────

function resolveAppUrl(req: NextRequest): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_ORIGIN ||
    "";
  if (env) return env.replace(/\/$/, "");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    new URL(req.url).host;
  return `${proto}://${host}`;
}

async function findUserIdByEmail(
  sb: SupabaseClient,
  email: string,
): Promise<string | null> {
  try {
    const normalized = email.toLowerCase();
    const { data, error } = await sb.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw error;
    const found = (data?.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === normalized,
    );
    return found?.id ?? null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[plus/webhook] findUserIdByEmail failed:", {
      email,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Sync `profiles.plan` for the buyer identified by email. Best-effort:
 * logs but never throws, so a missing profile / unknown email never fails
 * the webhook. The row in `pro_subscriptions` is the durable record; a
 * backfill query can repair `profiles.plan` after the fact if needed.
 */
async function syncProfilePlanByEmail(
  sb: SupabaseClient,
  email: string | null,
  plan: "pro" | null,
): Promise<void> {
  if (!email) return;
  const userId = await findUserIdByEmail(sb, email);
  if (!userId) {
    // eslint-disable-next-line no-console
    console.warn(
      "[plus/webhook] no auth user for email — skipping profiles.plan sync",
      { email },
    );
    return;
  }
  const { error } = await sb
    .from("profiles")
    .update({ plan })
    .eq("user_id", userId);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[plus/webhook] profiles.plan update failed (non-fatal):", {
      userId,
      plan,
      code: error.code,
      message: error.message,
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[plus/webhook] profiles.plan synced:", { userId, plan });
}

/**
 * Set `profiles.subscription_status = 'plus'` for the given email.
 * Best-effort / non-fatal — mirrors syncProfilePlanByEmail semantics.
 */
async function setSubscriptionStatusPlus(
  sb: SupabaseClient,
  email: string | null,
): Promise<void> {
  if (!email) return;
  try {
    const userId = await findUserIdByEmail(sb, email);
    if (!userId) return;
    const { error } = await sb
      .from("profiles")
      .update({ subscription_status: "plus" })
      .eq("user_id", userId);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        "[plus/webhook] subscription_status='plus' update failed (non-fatal):",
        { userId, code: error.code, message: error.message },
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("[plus/webhook] subscription_status='plus' set:", { userId });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      "[plus/webhook] subscription_status='plus' threw (non-fatal):",
      { err: e instanceof Error ? e.message : String(e) },
    );
  }
}

/**
 * Clear `profiles.subscription_status` when it is currently 'plus'.
 * Only clears 'plus' — leaves other values (e.g. 'beta') untouched.
 */
async function clearSubscriptionStatusPlus(
  sb: SupabaseClient,
  email: string | null,
): Promise<void> {
  if (!email) return;
  try {
    const userId = await findUserIdByEmail(sb, email);
    if (!userId) return;
    const { error } = await sb
      .from("profiles")
      .update({ subscription_status: null })
      .eq("user_id", userId)
      .eq("subscription_status", "plus");
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        "[plus/webhook] subscription_status clear failed (non-fatal):",
        { userId, code: error.code, message: error.message },
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        "[plus/webhook] subscription_status cleared (if was 'plus'):",
        { userId },
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      "[plus/webhook] subscription_status clear threw (non-fatal):",
      { err: e instanceof Error ? e.message : String(e) },
    );
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/plus/webhook
 *
 * Stripe-signed webhook for the /plus subscription product.
 *
 * This endpoint MUST be configured as a SEPARATE webhook in the Stripe
 * Dashboard (distinct from /api/pro/webhook and /api/webhooks/stripe).
 * It uses its own signing secret (STRIPE_PLUS_WEBHOOK_SECRET) so the
 * Plus billing flow stays isolated and independently debuggable.
 *
 * Idempotency:
 *   Before any business logic, the event_id is inserted into
 *   `stripe_processed_events` with endpoint='plus'. A unique-key violation
 *   (code 23505) means Stripe already delivered this event and we ACK 200
 *   without re-running any DB writes or email enqueues.
 *
 * Events handled:
 *   - checkout.session.completed     → create/upsert row in pro_subscriptions,
 *                                      set profiles.plan='pro',
 *                                      set profiles.subscription_status='plus',
 *                                      enqueue plus-welcome email + drip schedule.
 *   - customer.subscription.created  → early plan signal (before checkout.completed)
 *   - customer.subscription.updated  → status/period sync
 *   - customer.subscription.deleted  → mark cancelled, clear Plus flag
 *   - invoice.payment_succeeded      → renewal logging (alias: invoice.paid)
 *   - invoice.payment_failed         → log payment failure alert
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_PLUS_WEBHOOK_SECRET ?? "";

  if (!sig || !webhookSecret) {
    // eslint-disable-next-line no-console
    console.error(
      "[plus/webhook] missing signature or STRIPE_PLUS_WEBHOOK_SECRET",
    );
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  let stripe: Stripe;
  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[plus/webhook] signature verify failed:",
      (err as Error).message,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    // ── Idempotency check ────────────────────────────────────────────────────
    // Insert the event id before any business logic. On conflict = already
    // processed → ACK 200 without re-running DB writes or email enqueues.
    // A failed insert that is NOT a unique violation means the DB is down —
    // return 500 so Stripe retries with backoff (same idempotency key).
    const { error: idempotencyErr } = await sb
      .from("stripe_processed_events")
      .insert({ event_id: event.id, endpoint: "plus" });

    if (idempotencyErr) {
      if (idempotencyErr.code === "23505") {
        // eslint-disable-next-line no-console
        console.log("[plus/webhook] duplicate delivery — ACKing silently:", {
          eventId: event.id,
          type: event.type,
        });
        return NextResponse.json({ received: true, deduplicated: true });
      }
      // Transient DB error — let Stripe retry
      // eslint-disable-next-line no-console
      console.error(
        "[plus/webhook] idempotency insert failed:",
        idempotencyErr.code,
        idempotencyErr.message,
      );
      return NextResponse.json(
        { error: "idempotency_check_failed" },
        { status: 500 },
      );
    }

    // ── Event dispatch ───────────────────────────────────────────────────────
    switch (event.type) {
      // ── checkout.session.completed ─────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") {
          return NextResponse.json({
            received: true,
            ignored: "non-subscription session",
          });
        }

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
        const email =
          session.customer_details?.email?.toLowerCase() ??
          session.customer_email?.toLowerCase() ??
          null;
        const fullName = extractFullNameFromSession(session);

        // Mirror buyer name onto Stripe Customer (best-effort — non-blocking)
        if (fullName && customerId) {
          stripe.customers
            .update(customerId, { name: fullName })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.warn(
                "[plus/webhook] customers.update name failed (non-fatal):",
                {
                  customerId,
                  err: err instanceof Error ? err.message : String(err),
                },
              );
            });
        }

        const rowIdFromMeta =
          typeof session.metadata?.subscription_row_id === "string"
            ? session.metadata.subscription_row_id
            : null;

        // Retrieve subscription for authoritative trial/period dates
        let trialEndsAt: string | null = null;
        let stripeStatus: string | null = null;
        let priceId: string | null = null;
        let currentPeriodEnd: string | null = null;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          stripeStatus = sub.status;
          if (sub.trial_end)
            trialEndsAt = new Date(sub.trial_end * 1000).toISOString();
          const cpe = (sub as unknown as { current_period_end?: number })
            .current_period_end;
          if (cpe) currentPeriodEnd = new Date(cpe * 1000).toISOString();
          priceId = sub.items?.data?.[0]?.price?.id ?? null;
        }

        const sessionCurrency =
          typeof session.currency === "string"
            ? session.currency.toLowerCase()
            : null;
        const sessionCountry =
          typeof session.customer_details?.address?.country === "string"
            ? session.customer_details.address.country.toUpperCase()
            : null;

        const update: Record<string, unknown> = {
          status: mapStripeStatus(stripeStatus) ?? "trialing",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_session_id: session.id,
          stripe_price_id: priceId,
          trial_ends_at: trialEndsAt,
          current_period_end: currentPeriodEnd,
        };
        if (fullName) update.full_name = fullName;
        if (sessionCurrency) update.currency = sessionCurrency;
        if (sessionCountry) update.country = sessionCountry;

        // Three-layer row resolution (mirrors Pro webhook logic):
        //   1. metadata.subscription_row_id — set by /api/plus/checkout
        //   2. email match + update
        //   3. email upsert (creates row if absent)
        let bound = false;

        if (rowIdFromMeta) {
          const { data, error } = await sb
            .from("pro_subscriptions")
            .update(update)
            .eq("id", rowIdFromMeta)
            .select("id");
          if (error) {
            // eslint-disable-next-line no-console
            console.error(
              "[plus/webhook] update by row id failed:",
              error.code,
              error.message,
            );
            return NextResponse.json(
              { error: "db_update_failed" },
              { status: 500 },
            );
          }
          bound = !!data && data.length > 0;
        }

        if (!bound && email) {
          const { error } = await sb
            .from("pro_subscriptions")
            .upsert({ email, ...update }, { onConflict: "email" });
          if (error) {
            // eslint-disable-next-line no-console
            console.error(
              "[plus/webhook] upsert by email failed:",
              error.code,
              error.message,
            );
            return NextResponse.json(
              { error: "db_upsert_failed" },
              { status: 500 },
            );
          }
          bound = true;
        }

        if (!bound) {
          // eslint-disable-next-line no-console
          console.error(
            "[plus/webhook] no row_id and no email on completed session",
            session.id,
          );
          return NextResponse.json({
            received: true,
            error: "no_binding_key",
          });
        }

        // eslint-disable-next-line no-console
        console.log("[plus/webhook] subscription created:", {
          email,
          customerId,
          subscriptionId,
          trialEndsAt,
        });

        // Mirror Pro membership onto profiles.plan (Plus grants same features)
        const planAtCheckout = mapStripeStatusToPlan(stripeStatus) ?? "pro";
        await syncProfilePlanByEmail(sb, email, planAtCheckout);

        // Tag the Plus billing tier on profiles.subscription_status
        await setSubscriptionStatusPlus(sb, email);

        // Enqueue plus-welcome email (durable outbox; cron drains every ~2 min)
        if (email) {
          const name = fullName ?? session.customer_details?.name ?? null;
          const appUrl = resolveAppUrl(req);
          try {
            const locale =
              (session as unknown as { locale?: string | null }).locale === "en"
                ? "en"
                : "de";

            const { id: outboxId, deduplicated } = await enqueueEmail({
              recipient: email,
              template: "plus-welcome",
              payload: {
                name,
                sessionId: session.id,
                appUrl,
                trialEndsAt,
                locale,
              },
              dedupeKey: session.id,
            });
            // eslint-disable-next-line no-console
            console.log("[plus/webhook] welcome email enqueued:", {
              to: email,
              sessionId: session.id,
              template: "plus-welcome",
              outboxId,
              deduplicated,
            });

            await scheduleDripEmails(email, name, "plus", locale);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
              "[plus/webhook] outbox enqueue failed — asking Stripe to retry:",
              {
                to: email,
                sessionId: session.id,
                eventId: event.id,
                err: err instanceof Error ? err.message : String(err),
              },
            );
            return NextResponse.json(
              { error: "outbox enqueue failed, please retry" },
              { status: 500 },
            );
          }
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] no email on completed session — skipping welcome mail",
            session.id,
          );
        }

        return NextResponse.json({ received: true });
      }

      // ── customer.subscription.created ──────────────────────────────────────
      // Stripe sometimes fires this before checkout.session.completed. We do
      // NOT write pro_subscriptions here (completed-handler is the canonical
      // writer) but we DO mirror plan state to profiles so a delayed
      // completed-event can't leave a paying Plus user on "free".
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;

        // Guard: ignore subscriptions that don't belong to a Plus price.
        // Stripe delivers customer.subscription.created to every webhook
        // endpoint that subscribes to this event type — including Pro-Trial
        // subscriptions. Without this filter the handler would look up the
        // customer email from Stripe and incorrectly set
        // profiles.subscription_status = 'plus' for Pro buyers.
        const createdPriceId = sub.items?.data?.[0]?.price?.id ?? null;
        if (!isPlusPriceId(createdPriceId)) {
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] subscription.created ignored: not a plus subscription",
            { subId: sub.id, priceId: createdPriceId },
          );
          return NextResponse.json({
            received: true,
            ignored: "not_a_plus_subscription",
          });
        }

        const planFromStatus = mapStripeStatusToPlan(sub.status);
        if (planFromStatus !== undefined) {
          const { data: row } = await sb
            .from("pro_subscriptions")
            .select("email")
            .eq("stripe_subscription_id", sub.id)
            .maybeSingle();
          let email = (row as { email?: string | null } | null)?.email ?? null;
          if (!email && sub.customer) {
            try {
              const customerId =
                typeof sub.customer === "string"
                  ? sub.customer
                  : sub.customer.id;
              const cust = await stripe.customers.retrieve(customerId);
              if (!("deleted" in cust && cust.deleted)) {
                email = (cust as Stripe.Customer).email?.toLowerCase() ?? null;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn(
                "[plus/webhook] subscription.created customer fetch failed:",
                { err: e instanceof Error ? e.message : String(e) },
              );
            }
          }
          await syncProfilePlanByEmail(sb, email, planFromStatus);
          await setSubscriptionStatusPlus(sb, email);
        }
        return NextResponse.json({ received: true });
      }

      // ── customer.subscription.updated ──────────────────────────────────────
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        // Guard: ignore non-Plus subscriptions. The updated event is delivered
        // to all webhook endpoints. A Pro subscription update would attempt to
        // update a pro_subscriptions row (it won't find one bound by this
        // endpoint's checkout, so it would return a 500 "row_not_yet_bound"
        // and trigger a Stripe retry loop). Early-ACK prevents that.
        const updatedPriceId = sub.items?.data?.[0]?.price?.id ?? null;
        if (!isPlusPriceId(updatedPriceId)) {
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] subscription.updated ignored: not a plus subscription",
            { subId: sub.id, priceId: updatedPriceId },
          );
          return NextResponse.json({
            received: true,
            ignored: "not_a_plus_subscription",
          });
        }

        const cpe = (sub as unknown as { current_period_end?: number })
          .current_period_end;
        const update: Record<string, unknown> = {
          status: mapStripeStatus(sub.status) ?? "active",
          current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
          trial_ends_at: sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null,
        };

        const { data, error: updErr } = await sb
          .from("pro_subscriptions")
          .update(update)
          .eq("stripe_subscription_id", sub.id)
          .select("id, email");

        if (updErr) {
          // eslint-disable-next-line no-console
          console.error(
            "[plus/webhook] subscription.updated failed:",
            updErr.code,
            updErr.message,
          );
          return NextResponse.json(
            { error: "db_update_failed" },
            { status: 500 },
          );
        }
        if (!data || data.length === 0) {
          // Race: updated before completed — Stripe retries; completed will
          // create the row and updated will succeed on re-delivery.
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] subscription.updated for unbound subscription:",
            sub.id,
          );
          return NextResponse.json(
            { error: "row_not_yet_bound" },
            { status: 500 },
          );
        }

        const planFromStatus = mapStripeStatusToPlan(sub.status);
        if (planFromStatus !== undefined) {
          const rowEmail =
            (data[0] as { email?: string | null }).email ?? null;
          await syncProfilePlanByEmail(sb, rowEmail, planFromStatus);
        }
        return NextResponse.json({ received: true });
      }

      // ── customer.subscription.deleted ──────────────────────────────────────
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        // Guard: ignore non-Plus subscriptions to prevent a wrong
        // "plus-cancelled" email being sent to Pro-Trial users.
        //
        // Stripe delivers customer.subscription.deleted to ALL registered
        // webhook endpoints. Without this filter, every Pro cancellation also
        // triggers this handler and enqueues a "plus-cancelled" mail that says
        // "Glev+ €29/Monat Lifetime-Lock" — wrong plan, wrong price.
        //
        // The authoritative price ID is on the subscription object itself
        // (sub.items.data[0].price.id), which Stripe always includes in
        // customer.subscription.deleted events.
        const deletedPriceId = sub.items?.data?.[0]?.price?.id ?? null;
        if (!isPlusPriceId(deletedPriceId)) {
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] subscription.deleted ignored: not a plus subscription",
            { subId: sub.id, priceId: deletedPriceId },
          );
          return NextResponse.json({
            received: true,
            ignored: "not_a_plus_subscription",
          });
        }

        const { data, error: updErr } = await sb
          .from("pro_subscriptions")
          .update({ status: "cancelled" })
          .eq("stripe_subscription_id", sub.id)
          .select("id, email, full_name, currency");

        if (updErr) {
          // eslint-disable-next-line no-console
          console.error(
            "[plus/webhook] subscription.deleted failed:",
            updErr.code,
            updErr.message,
          );
          return NextResponse.json(
            { error: "db_update_failed" },
            { status: 500 },
          );
        }
        if (!data || data.length === 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[plus/webhook] subscription.deleted for unbound subscription:",
            sub.id,
          );
          return NextResponse.json(
            { error: "row_not_yet_bound" },
            { status: 500 },
          );
        }

        const row = data[0] as { email?: string | null; full_name?: string | null; currency?: string | null };
        const rowEmail = row.email ?? null;

        // Drop plan back to free
        await syncProfilePlanByEmail(sb, rowEmail, null);

        // Clear the Plus tier marker (only if currently 'plus'; leaves other
        // values like 'beta' untouched)
        await clearSubscriptionStatusPlus(sb, rowEmail);

        // Bestätigungsmail an Käufer:in — best-effort, non-fatal.
        // Locale aus Währung ableiten (EUR → de, USD → en).
        if (rowEmail) {
          try {
            const locale =
              (row.currency ?? "").toUpperCase() === "USD" ? "en" : "de";
            const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
            const accessEndsAt = cpe ? new Date(cpe * 1000).toISOString() : null;
            await enqueueEmail({
              recipient: rowEmail,
              template: "plus-cancelled",
              payload: {
                name: row.full_name ?? null,
                accessEndsAt,
                locale,
              },
              dedupeKey: `cancelled-${sub.id}`,
            });
            // eslint-disable-next-line no-console
            console.log("[plus/webhook] cancellation email enqueued:", { email: rowEmail });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[plus/webhook] cancellation email enqueue failed (non-fatal):", {
              email: rowEmail,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // eslint-disable-next-line no-console
        console.log("[plus/webhook] subscription cancelled:", {
          subId: sub.id,
          email: rowEmail,
        });
        return NextResponse.json({ received: true });
      }

      // ── invoice.payment_succeeded / invoice.paid ───────────────────────────
      // Renewal cycle: confirm user is still current. Both event names are
      // handled — 'invoice.paid' is the current Stripe name, 'invoice.payment_succeeded'
      // was the older alias that some Stripe accounts still emit.
      case "invoice.payment_succeeded":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof (invoice as unknown as { subscription?: unknown })
            .subscription === "string"
            ? (invoice as unknown as { subscription: string }).subscription
            : (
                invoice as unknown as {
                  subscription?: { id?: string };
                }
              ).subscription?.id ?? null;
        if (!subId) {
          return NextResponse.json({
            received: true,
            ignored: "no_subscription",
          });
        }

        const { data: row } = await sb
          .from("pro_subscriptions")
          .select("email")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        const email =
          (row as { email?: string | null } | null)?.email ??
          invoice.customer_email?.toLowerCase() ??
          null;

        // eslint-disable-next-line no-console
        console.log("[plus/webhook] invoice paid — renewal confirmed:", {
          subId,
          email,
          invoiceId: invoice.id,
          amount: invoice.amount_paid,
        });

        // Re-confirm plan is active (catches edge-case where subscription.updated
        // arrived late or was missed entirely)
        await syncProfilePlanByEmail(sb, email, "pro");

        return NextResponse.json({ received: true });
      }

      // ── invoice.payment_failed ─────────────────────────────────────────────
      // Billing failure: log alert. profiles.plan stays 'pro' during Stripe's
      // grace period (past_due). Real cancellation flows through
      // subscription.deleted → plan=null.
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof (invoice as unknown as { subscription?: unknown })
            .subscription === "string"
            ? (invoice as unknown as { subscription: string }).subscription
            : (
                invoice as unknown as {
                  subscription?: { id?: string };
                }
              ).subscription?.id ?? null;

        const { data: row } = await sb
          .from("pro_subscriptions")
          .select("email")
          .eq("stripe_subscription_id", subId ?? "")
          .maybeSingle();
        const email =
          (row as { email?: string | null } | null)?.email ??
          invoice.customer_email?.toLowerCase() ??
          null;

        // eslint-disable-next-line no-console
        console.error("[plus/webhook] PAYMENT FAILED — alert:", {
          subId,
          email,
          invoiceId: invoice.id,
          amount: invoice.amount_due,
          attemptCount: invoice.attempt_count,
        });

        // Future: trigger payment-failure notification email here.
        // For now we log loudly so Vercel / Datadog alerts fire on "PAYMENT FAILED".

        return NextResponse.json({ received: true });
      }

      default:
        // ACK everything else without doing work.
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[plus/webhook] unexpected:", e);
    // Return 200 to avoid Stripe retry storms — signature has been verified.
    return NextResponse.json({ received: true, error: "unexpected" });
  }
}
