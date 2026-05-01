import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { Resend } from "resend";
import { getStripe } from "@/lib/stripeServer";
import { extractFullNameFromSession } from "@/lib/stripeCheckout";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { proWelcomeHtml } from "@/lib/emails/pro-welcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lazy Resend client — constructing it at module load throws if RESEND_API_KEY
 * is missing or contains weird chars (e.g. an accidentally-pasted placeholder),
 * which would 500 every webhook delivery before we even reach the DB write.
 * Defer to first use so a bad key only fails the email send (logged + swallowed)
 * instead of the whole route.
 */
function getResend(): Resend {
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Resolve the public app origin used in the Resume-Link inside the welcome
 * email. Prefer the explicit env vars; fall back to the request host so the
 * link still points at the *correct* deployment if env isn't configured
 * (otherwise we'd email people a glev.app link from a preview deploy).
 */
function resolveAppUrl(req: NextRequest): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_ORIGIN ||
    "";
  if (env) return env.replace(/\/$/, "");
  const proto =
    req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

/**
 * POST /api/pro/webhook
 *
 * Stripe-signed webhook for the /pro subscription product.
 *
 * Important: this endpoint MUST be configured in the Stripe dashboard as a
 * SECOND, separate webhook (in addition to /api/beta/webhook). It uses its
 * own signing secret (STRIPE_PRO_WEBHOOK_SECRET) so the two product flows
 * stay isolated and debuggable.
 *
 * Events handled:
 *   - checkout.session.completed     → create/upgrade row to 'trialing'
 *   - customer.subscription.updated  → keep status + period dates in sync
 *   - customer.subscription.deleted  → mark 'cancelled'
 *
 * All updates are scoped by stripe_subscription_id (after first set) or
 * email fallback, and are written idempotently so Stripe retries are safe.
 */
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_PRO_WEBHOOK_SECRET ?? "";

  if (!sig || !webhookSecret) {
    // eslint-disable-next-line no-console
    console.error("[pro/webhook] missing signature or STRIPE_PRO_WEBHOOK_SECRET");
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
    console.error("[pro/webhook] signature verify failed:", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") {
          return NextResponse.json({ received: true, ignored: "non-subscription session" });
        }

        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;
        const email =
          session.customer_details?.email?.toLowerCase() ??
          session.customer_email?.toLowerCase() ??
          null;
        // Pull the buyer's name from the mandatory `full_name` Checkout
        // custom field (task #68). Persist it on the row so support tooling
        // and future personalised mails can address the buyer by name
        // without re-querying Stripe.
        const fullName = extractFullNameFromSession(session);
        const rowIdFromMeta =
          typeof session.metadata?.subscription_row_id === "string"
            ? session.metadata.subscription_row_id
            : null;

        // Fetch the subscription so we know trial_end + status authoritatively.
        let trialEndsAt: string | null = null;
        let stripeStatus: string | null = null;
        let priceId: string | null = null;
        let currentPeriodEnd: string | null = null;

        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          stripeStatus = sub.status;
          if (sub.trial_end) trialEndsAt = new Date(sub.trial_end * 1000).toISOString();
          // Subscription type has current_period_end on the items; on the top-level
          // it exists too in newer API versions. Use a defensive cast.
          const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
          if (cpe) currentPeriodEnd = new Date(cpe * 1000).toISOString();
          priceId = sub.items?.data?.[0]?.price?.id ?? null;
        }

        const update: Record<string, unknown> = {
          status: mapStripeStatus(stripeStatus) ?? "trialing",
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_price_id: priceId,
          trial_ends_at: trialEndsAt,
          current_period_end: currentPeriodEnd,
        };
        // Only stamp full_name when we actually got one — never blank out a
        // previously stored name on a Stripe retry that omits the field.
        if (fullName) update.full_name = fullName;

        // Three-layer row resolution, most-reliable first:
        //   1. metadata.subscription_row_id — set by /api/pro/checkout, immune
        //      to email normalization differences and Checkout email edits.
        //   2. email match — handles older sessions or rows we created without
        //      stamping the metadata for some reason.
        //   3. upsert by email — covers the rare case where Stripe fired
        //      checkout.session.completed before our pending insert finished
        //      (or the insert failed entirely). Better to create the row than
        //      to silently drop the conversion.
        let bound = false;

        if (rowIdFromMeta) {
          const { data, error } = await sb
            .from("pro_subscriptions")
            .update(update)
            .eq("id", rowIdFromMeta)
            .select("id");
          if (error) {
            // eslint-disable-next-line no-console
            console.error("[pro/webhook] update by row id failed:", error.code, error.message);
            // 500 → Stripe retries with backoff; transient DB errors recover.
            return NextResponse.json({ error: "db_update_failed" }, { status: 500 });
          }
          bound = !!data && data.length > 0;
        }

        if (!bound && email) {
          // Upsert keyed on email (the table has a unique constraint on email).
          // Set trial defaults on insert, but let `update` override on update.
          const { error } = await sb
            .from("pro_subscriptions")
            .upsert(
              {
                email,
                ...update,
              },
              { onConflict: "email" },
            );
          if (error) {
            // eslint-disable-next-line no-console
            console.error("[pro/webhook] upsert by email failed:", error.code, error.message);
            return NextResponse.json({ error: "db_upsert_failed" }, { status: 500 });
          }
          bound = true;
        }

        if (!bound) {
          // No row id, no email — nothing we can do but log loudly. Ack 200
          // because retrying won't help (this is permanent, not transient).
          // eslint-disable-next-line no-console
          console.error("[pro/webhook] no row_id and no email on completed session", session.id);
          return NextResponse.json({ received: true, error: "no_binding_key" });
        }

        // eslint-disable-next-line no-console
        console.log("[pro/webhook] subscription created:", { email, customerId, subscriptionId, trialEndsAt });

        // Send the post-checkout welcome email via Resend. Critically this
        // includes a Resume-Link to /pro/success?session_id=… so the buyer
        // can come back days later and confirm the subscription even if they
        // closed the success-tab. Send is best-effort: if Resend fails we
        // still ack 200 so Stripe doesn't retry the webhook (the DB write
        // already succeeded above and that's the load-bearing part).
        if (email) {
          // Prefer the explicit `full_name` custom field over Stripe's
          // auto-collected billing-details name — same precedence as the
          // beta webhook so both flows greet the buyer identically.
          const name = fullName ?? session.customer_details?.name ?? null;
          const appUrl = resolveAppUrl(req);
          try {
            const resend = getResend();
            const { data, error } = await resend.emails.send({
              from: "Glev <info@glev.app>",
              to: email,
              subject: "Deine Glev-Mitgliedschaft ist angelegt",
              html: proWelcomeHtml(name, session.id, appUrl, trialEndsAt),
            });
            if (error) {
              // Resend SDK returns errors as a structured object on the
              // response — not as a thrown exception (only transport-level
              // failures throw). Surface the FULL body — name, message,
              // statusCode if present — so prod logs actually show *why*
              // delivery failed (unverified domain, invalid recipient, etc.)
              // instead of the generic "Failed to send".
              // eslint-disable-next-line no-console
              console.error("[pro/webhook] Resend send returned error:", {
                to: email,
                sessionId: session.id,
                error,
              });
            } else if (data?.id) {
              // Success: log message-id so we can grep delivery confirmations.
              // eslint-disable-next-line no-console
              console.log("[pro/webhook] welcome email sent:", {
                to: email,
                sessionId: session.id,
                messageId: data.id,
              });
            } else {
              // Should not happen — Resend always returns either data or
              // error — but log noisily so we notice if the contract changes.
              // eslint-disable-next-line no-console
              console.warn("[pro/webhook] Resend send returned no data and no error:", {
                to: email,
                sessionId: session.id,
              });
            }
          } catch (err) {
            // Transport-level / network error — Resend SDK threw. Include
            // the full error so the operator can see status code + body.
            // eslint-disable-next-line no-console
            console.error("[pro/webhook] Resend send threw:", {
              to: email,
              sessionId: session.id,
              err,
            });
          }
        } else {
          // No email on the session — we already logged this loudly above
          // for the binding-key path; repeat here so the email failure mode
          // is also visible.
          // eslint-disable-next-line no-console
          console.warn("[pro/webhook] no email on completed session — skipping welcome mail", session.id);
        }

        return NextResponse.json({ received: true });
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
        const update: Record<string, unknown> = {
          status: mapStripeStatus(sub.status) ?? "active",
          current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        };

        const { data, error: updErr } = await sb
          .from("pro_subscriptions")
          .update(update)
          .eq("stripe_subscription_id", sub.id)
          .select("id");

        if (updErr) {
          // eslint-disable-next-line no-console
          console.error("[pro/webhook] subscription.updated failed:", updErr.code, updErr.message);
          return NextResponse.json({ error: "db_update_failed" }, { status: 500 });
        }
        if (!data || data.length === 0) {
          // Subscription not yet bound to a row — likely because Stripe sent
          // subscription.updated before checkout.session.completed (their docs
          // explicitly warn this can happen). Return 500 so Stripe retries
          // with backoff; eventually completed will create the row.
          // eslint-disable-next-line no-console
          console.warn("[pro/webhook] subscription.updated for unbound subscription:", sub.id);
          return NextResponse.json({ error: "row_not_yet_bound" }, { status: 500 });
        }
        return NextResponse.json({ received: true });
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { data, error: updErr } = await sb
          .from("pro_subscriptions")
          .update({ status: "cancelled" })
          .eq("stripe_subscription_id", sub.id)
          .select("id");

        if (updErr) {
          // eslint-disable-next-line no-console
          console.error("[pro/webhook] subscription.deleted failed:", updErr.code, updErr.message);
          return NextResponse.json({ error: "db_update_failed" }, { status: 500 });
        }
        if (!data || data.length === 0) {
          // Same race window as subscription.updated above.
          // eslint-disable-next-line no-console
          console.warn("[pro/webhook] subscription.deleted for unbound subscription:", sub.id);
          return NextResponse.json({ error: "row_not_yet_bound" }, { status: 500 });
        }
        return NextResponse.json({ received: true });
      }

      default:
        // Ack everything else without doing work.
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pro/webhook] unexpected:", e);
    // Return 200 to avoid Stripe retry storms — signature has been verified.
    return NextResponse.json({ received: true, error: "unexpected" });
  }
}

/**
 * Map a Stripe subscription status to the constrained set we store in
 * pro_subscriptions.status. Returns null when the input is unknown — caller
 * should fall back to a sensible default ('trialing' on creation, 'active'
 * on update). Stripe's 'canceled' is normalized to 'cancelled' (British
 * spelling chosen by /beta — kept consistent here).
 */
function mapStripeStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
      return s;
    case "canceled":
    case "incomplete_expired":
    case "unpaid":
      return "cancelled";
    default:
      // 'incomplete', 'paused' etc. — treat as past_due so we don't grant access
      // but also don't claim cancelled.
      return "past_due";
  }
}
