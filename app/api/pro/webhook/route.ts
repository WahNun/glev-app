import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripeServer";
import { extractFullNameFromSession } from "@/lib/stripeCheckout";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enqueueEmail } from "@/lib/emails/outbox";
import { scheduleDripEmails } from "@/lib/emails/drip-scheduler";
import { sendCapiEvent } from "@/lib/fb-capi-server";
import { isPlusPriceId } from "@/lib/stripeWebhookHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Map a Stripe subscription status to the value we want to write into
 * `profiles.plan`. Only "trialing" / "active" / "past_due" grant Pro access;
 * anything terminal (cancelled, unpaid, incomplete_expired) clears the plan
 * back to free. Returns `undefined` for unknown statuses so the caller can
 * choose to leave `profiles.plan` untouched in that case.
 */
function mapStripeStatusToPlan(s: string | null | undefined): "pro" | null | undefined {
  if (!s) return undefined;
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
      return "pro";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return null;
    default:
      return undefined;
  }
}

/**
 * Resolve a Supabase auth user id by email. Mirrors the pagination strategy
 * used by `app/admin/users/actions.ts` (Supabase admin SDK has no
 * `getUserByEmail`). Webhook traffic is low-volume so paginating ≤1000 users
 * per call is fine; if we ever exceed that we'll need a SQL-based lookup.
 *
 * Returns `null` when the email is unknown — callers must treat that as a
 * non-fatal "no profile to update" case so we don't fail the webhook just
 * because the buyer hasn't created an app account yet.
 */
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
    console.warn("[pro/webhook] findUserIdByEmail failed:", {
      email,
      err: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Sync `profiles.plan` for the buyer derived from `email`. Best-effort:
 * we log but never throw, so a missing profile / unknown email never fails
 * the webhook (the row in `pro_subscriptions` is the durable record; the
 * backfill SQL can repair `profiles.plan` after the fact if needed).
 *
 * `plan` semantics:
 *   - "pro"  → profile is a paying / trialing Pro user
 *   - null   → terminal status, downgrade back to free
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
    console.warn("[pro/webhook] no auth user for email — skipping profiles.plan sync", { email });
    return;
  }
  const { error } = await sb
    .from("profiles")
    .update({ plan })
    .eq("user_id", userId);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[pro/webhook] profiles.plan update failed (non-fatal):", {
      userId,
      plan,
      code: error.code,
      message: error.message,
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.log("[pro/webhook] profiles.plan synced:", { userId, plan });
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

        // Mirror the buyer's full_name onto the Stripe Customer object so it
        // surfaces in the Stripe Dashboard (Customer detail view, Customers
        // list, mobile app). The custom_field value normally lives only on
        // the Session — without this patch every Customer shows up nameless
        // even though we collected the name in Checkout.
        // Best-effort: any failure is logged but never blocks the critical
        // path. Stripe's retry logic for the webhook itself depends on us
        // returning 2xx after the DB upsert + outbox enqueue — a transient
        // customers.update failure would needlessly trigger a full retry.
        if (fullName && customerId) {
          stripe.customers
            .update(customerId, { name: fullName })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.warn("[pro/webhook] customers.update name failed (non-fatal):", {
                customerId,
                err: err instanceof Error ? err.message : String(err),
              });
            });
        }

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

        // Stripe currency on the session is the lowercase 3-letter ISO
        // code the buyer paid in (eur/usd). Country is on customer_details.
        // address.country (uppercase 2-letter, DE/US/…). Both feed the
        // admin filter on /admin/users.
        const sessionCurrency =
          typeof session.currency === "string" ? session.currency.toLowerCase() : null;
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
        // Only stamp full_name when we actually got one — never blank out a
        // previously stored name on a Stripe retry that omits the field.
        if (fullName) update.full_name = fullName;
        // Same defensive pattern for currency/country: only write when
        // present so a Stripe retry that omits them doesn't clobber a
        // previously-captured value.
        if (sessionCurrency) update.currency = sessionCurrency;
        if (sessionCountry) update.country = sessionCountry;

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

        // Plus (€29/mo lifetime-lock) and Pro (€14,90/mo) both land here
        // because /api/checkout/plus and /api/checkout/pro are routed to
        // the same Stripe webhook endpoint (STRIPE_PRO_WEBHOOK_SECRET).
        // For access control they're identical → `profiles.plan='pro'`
        // grants the same gated features. The only difference we persist
        // is `profiles.subscription_status='plus'` so admin tooling and
        // future analytics can tell the two SKUs apart without joining
        // back through pro_subscriptions.stripe_price_id.
        // EffectivePlan stays "free|beta|pro" — no schema migration
        // needed, Plus is purely a billing-tier distinction.
        const isPlus = session.metadata?.feature === "plus_subscription";

        // eslint-disable-next-line no-console
        console.log(`[pro/webhook${isPlus ? " plus" : ""}] subscription created:`, {
          email, customerId, subscriptionId, trialEndsAt, feature: session.metadata?.feature ?? null,
        });

        // Mirror the Pro membership onto `profiles.plan` so the rest of the
        // app (paywalls, badges, /api/me/plan) reads a single source of
        // truth instead of joining `pro_subscriptions` from every consumer.
        // Default to "pro" when Stripe hasn't reported a status yet — the
        // checkout just completed, the trial is starting now.
        const planAtCheckout = mapStripeStatusToPlan(stripeStatus) ?? "pro";
        await syncProfilePlanByEmail(sb, email, planAtCheckout);

        // Tag the Plus tier on the profile. Best-effort: do not fail the
        // webhook if the lookup/update fails (mirrors syncProfilePlanByEmail
        // semantics). Same email-→userId resolver as above.
        if (isPlus && email) {
          try {
            const userId = await findUserIdByEmail(sb, email);
            if (userId) {
              const { error: ssErr } = await sb
                .from("profiles")
                .update({ subscription_status: "plus" })
                .eq("user_id", userId);
              if (ssErr) {
                // eslint-disable-next-line no-console
                console.warn("[pro/webhook plus] subscription_status update failed (non-fatal):", {
                  userId, code: ssErr.code, message: ssErr.message,
                });
              } else {
                // eslint-disable-next-line no-console
                console.log("[pro/webhook plus] subscription_status='plus' set", { userId });
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[pro/webhook plus] subscription_status sync threw (non-fatal):", {
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // Enqueue the post-checkout welcome email into the durable outbox
        // (lib/emails/outbox.ts). The cron worker (/api/cron/flush-outbox,
        // hit by .github/workflows/flush-outbox.yml every ~2 min) drains
        // the queue with retry + dead-letter, so a Resend outage or server
        // crash between Stripe-Ack and send no longer drops the buyer's
        // welcome mail. Mirrors the beta webhook (Task #35).
        //
        // The mail carries the load-bearing Resume-Link to
        // /pro/success?session_id=… so the buyer can come back days later
        // and confirm the subscription even if they closed the success-tab.
        // If the enqueue itself fails (Supabase down etc.) we MUST return a
        // non-2xx so Stripe retries the whole webhook — otherwise the buyer
        // pays and never gets the link. The DB updates above are
        // idempotent (status guards, upsert) so re-running them is safe.
        //
        // The Stripe session id is the dedupe key: a partial unique index
        // on (template, dedupe_key) means a retried webhook delivery
        // returns the existing outbox row id instead of enqueueing a
        // second mail.
        if (email) {
          // Prefer the explicit `full_name` custom field over Stripe's
          // auto-collected billing-details name — same precedence as the
          // beta webhook so both flows greet the buyer identically.
          const name = fullName ?? session.customer_details?.name ?? null;
          const appUrl = resolveAppUrl(req);
          try {
            // Stripe Checkout Session locale was set by the checkout
            // endpoint based on the buyer's currency selection (EUR →
            // 'de', USD → 'en'). Default to 'de' if Stripe didn't echo
            // it back so a missing field never silently flips someone
            // to English.
            const locale =
              (session as unknown as { locale?: string | null }).locale === "en"
                ? "en"
                : "de";

            // Plus vs Pro: Tier-Marker steuert sowohl das Welcome-Template
            // (plus-welcome zeigt €29/Lifetime-Lock-Copy, pro-welcome zeigt
            // €14,90/Monat) als auch das Tier-Tag in der Drip-Tabelle. Beide
            // Käufer-Typen landen im selben Webhook, weil /api/checkout/plus
            // dieselbe Session-Pipeline benutzt wie /api/checkout/pro — der
            // Unterschied ist nur metadata.feature.
            const welcomeTemplate = isPlus ? "plus-welcome" : "pro-welcome";
            const dripTier: "pro" | "plus" = isPlus ? "plus" : "pro";

            const { id: outboxId, deduplicated } = await enqueueEmail({
              recipient: email,
              template: welcomeTemplate,
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
            console.log("[pro/webhook] welcome email enqueued:", {
              to: email,
              sessionId: session.id,
              template: welcomeTemplate,
              outboxId,
              deduplicated,
            });

            // Drip-Sequenz Tag 7/14/30 einplanen (Task #160). Nur nach
            // erfolgreichem Welcome-Enqueue, damit ein Stripe-Retry
            // (durch das 500 unten ausgelöst) nicht Drip-Termine ohne
            // zugehörige Welcome-Mail hinterlässt. scheduleDripEmails
            // wirft nicht — DB-Fehler werden geloggt, der Stripe-Retry-
            // Pfad bleibt unverändert.
            await scheduleDripEmails(email, name, dripTier, locale);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[pro/webhook] Outbox enqueue failed — asking Stripe to retry:", {
              to: email,
              sessionId: session.id,
              eventId: event.id,
              err: err instanceof Error ? err.message : String(err),
            });
            return NextResponse.json(
              { error: "outbox enqueue failed, please retry" },
              { status: 500 },
            );
          }
        } else {
          // No email on the session — we already logged this loudly above
          // for the binding-key path; repeat here so the email failure mode
          // is also visible.
          // eslint-disable-next-line no-console
          console.warn("[pro/webhook] no email on completed session — skipping welcome mail", session.id);
        }

        // CAPI Purchase — fire-and-forget. Blockiert nie den Webhook-Return,
        // da Meta-Fehler kein Stripe-Retry-Grund sind. event_id = session.id
        // stellt sicher dass Browser-Pixel (falls vorhanden) dedupliziert wird.
        if (email) {
          const planName = session.metadata?.plan_name || (isPlus ? "Glev+" : "Glev Pro");
          const planId   = session.metadata?.plan_id   || (isPlus ? "glev-plus-monthly" : "glev-pro-monthly");
          const value    =
            typeof session.amount_total === "number"
              ? session.amount_total / 100
              : isPlus ? 29 : 14.9;
          const currency: "EUR" | "USD" =
            typeof session.currency === "string" && session.currency.toUpperCase() === "USD"
              ? "USD"
              : "EUR";
          sendCapiEvent(
            {
              email,
              externalId: email,
              subscriptionId: subscriptionId ?? undefined,
              country: sessionCountry?.toLowerCase() ?? "de",
            },
            {
              eventName:      "Purchase",
              eventId:        `purchase_${session.id}`,
              eventSourceUrl: `${resolveAppUrl(req)}/pro/success`,
              actionSource:   "website",
              value,
              currency,
              contentName:    planName,
              contentIds:     [planId],
              contentType:    "product",
              orderId:        session.id,
            },
          ).catch((e) =>
            // eslint-disable-next-line no-console
            console.warn("[pro/webhook] CAPI Purchase failed (non-fatal):", e),
          );
        }

        // Reward the referrer when the new user's first payment comes in
        // (payment_status === 'paid' = immediate charge, no trial = referred user).
        if (session.payment_status === "paid" && email) {
          rewardReferrerIfEligible(sb, email).catch((e) =>
            // eslint-disable-next-line no-console
            console.warn("[pro/webhook] referral reward failed (non-fatal):", e),
          );
        }

        return NextResponse.json({ received: true });
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        // Guard: skip Plus-subscription events that Stripe fan-outs to this
        // endpoint. The Plus webhook owns those rows; processing them here
        // would write incorrect status or trigger the wrong email template.
        const updatedPriceId = sub.items?.data?.[0]?.price?.id ?? null;
        if (isPlusPriceId(updatedPriceId)) {
          // eslint-disable-next-line no-console
          console.log("[pro/webhook] subscription.updated: ignoring Plus price ID", {
            subId: sub.id,
            priceId: updatedPriceId,
          });
          return NextResponse.json({ received: true, ignored: "plus subscription" });
        }

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
          .select("id, email");

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

        // Mirror the new status onto `profiles.plan`. We only touch the
        // profile when the Stripe status maps to a known plan transition
        // ("pro" or "free"); unknown/transient statuses (incomplete, paused)
        // leave the profile untouched so we don't flap a paying user back
        // to free during a momentary state we don't fully understand.
        const planFromStatus = mapStripeStatusToPlan(sub.status);
        if (planFromStatus !== undefined) {
          const rowEmail = (data[0] as { email?: string | null }).email ?? null;
          await syncProfilePlanByEmail(sb, rowEmail, planFromStatus);
        }
        return NextResponse.json({ received: true });
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        // Guard: skip Plus-subscription events that Stripe fan-outs to this
        // endpoint. The Plus webhook owns the cancellation flow for Plus rows
        // (subscription_status clear, plus-cancelled email). Processing them
        // here would clobber profiles incorrectly.
        const deletedPriceId = sub.items?.data?.[0]?.price?.id ?? null;
        if (isPlusPriceId(deletedPriceId)) {
          // eslint-disable-next-line no-console
          console.log("[pro/webhook] subscription.deleted: ignoring Plus price ID", {
            subId: sub.id,
            priceId: deletedPriceId,
          });
          return NextResponse.json({ received: true, ignored: "plus subscription" });
        }

        const { data, error: updErr } = await sb
          .from("pro_subscriptions")
          .update({ status: "cancelled" })
          .eq("stripe_subscription_id", sub.id)
          .select("id, email, full_name, currency");

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

        // Subscription terminated → drop `profiles.plan` back to free so the
        // user immediately loses Pro access on next page load.
        const row = data[0] as { email?: string | null; full_name?: string | null; currency?: string | null };
        const rowEmail = row.email ?? null;
        await syncProfilePlanByEmail(sb, rowEmail, null);

        // Zusätzlich: falls der/die User:in als Glev+ markiert war
        // (`profiles.subscription_status = 'plus'`), diesen Marker mit
        // zurücksetzen. Sonst hängt das Plus-Tag in den Admin-Tools
        // ewig an einem Profil, das gar keine aktive Plus-Subscription
        // mehr hat. Nur bei Wert 'plus' clearen, damit ein
        // existierender 'beta'-Marker (theoretisch möglich bei einem
        // Ex-Beta-User der auch Pro hatte) nicht versehentlich
        // gelöscht wird. Best-effort/non-fatal — Logik mirror-t
        // syncProfilePlanByEmail.
        if (rowEmail) {
          try {
            const userId = await findUserIdByEmail(sb, rowEmail);
            if (userId) {
              const { error: clearErr } = await sb
                .from("profiles")
                .update({ subscription_status: null })
                .eq("user_id", userId)
                .eq("subscription_status", "plus");
              if (clearErr) {
                // eslint-disable-next-line no-console
                console.warn("[pro/webhook plus] subscription_status clear failed (non-fatal):", {
                  userId,
                  code: clearErr.code,
                  message: clearErr.message,
                });
              } else {
                // eslint-disable-next-line no-console
                console.log("[pro/webhook plus] subscription_status cleared (if was 'plus')", { userId });
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[pro/webhook plus] subscription_status clear threw (non-fatal):", {
              email: rowEmail,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
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
              template: "pro-cancelled",
              payload: {
                name: row.full_name ?? null,
                accessEndsAt,
                locale,
              },
              dedupeKey: `cancelled-${sub.id}`,
            });
            // eslint-disable-next-line no-console
            console.log("[pro/webhook] cancellation email enqueued:", { email: rowEmail });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[pro/webhook] cancellation email enqueue failed (non-fatal):", {
              email: rowEmail,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return NextResponse.json({ received: true });
      }

      case "customer.subscription.created": {
        // Stripe occasionally emits subscription.created before
        // checkout.session.completed. We don't touch pro_subscriptions here
        // (the completed-handler is the canonical writer with full session
        // context — price id, currency, full_name, row binding) — but we
        // DO mirror plan state to profiles so a delayed completed-event
        // can't leave a paying user on "free". The completed-handler is
        // idempotent and will re-run sync immediately after.
        const sub = event.data.object as Stripe.Subscription;
        const planFromStatus = mapStripeStatusToPlan(sub.status);
        if (planFromStatus !== undefined) {
          // Resolve email via the existing pro_subscriptions row if it
          // exists; otherwise fall back to the Stripe Customer object so
          // the very-first-event-after-checkout case still finds the user.
          const { data: row } = await sb
            .from("pro_subscriptions")
            .select("email")
            .eq("stripe_subscription_id", sub.id)
            .maybeSingle();
          let email = (row as { email?: string | null } | null)?.email ?? null;
          if (!email && sub.customer) {
            try {
              const customerId =
                typeof sub.customer === "string" ? sub.customer : sub.customer.id;
              const cust = await stripe.customers.retrieve(customerId);
              if (!("deleted" in cust && cust.deleted)) {
                email = (cust as Stripe.Customer).email?.toLowerCase() ?? null;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[pro/webhook] subscription.created customer fetch failed:", {
                err: e instanceof Error ? e.message : String(e),
              });
            }
          }
          await syncProfilePlanByEmail(sb, email, planFromStatus);
        }
        return NextResponse.json({ received: true });
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        // Invoice events let us catch billing transitions that don't always
        // come with a subscription.updated (Stripe sometimes only fires the
        // invoice for renewal cycles). invoice.paid → user is current
        // ('pro'); invoice.payment_failed → status flips to past_due
        // server-side, which we still treat as 'pro' (Stripe's grace window
        // — they can update their card before being cancelled). Terminal
        // cancellation comes through subscription.deleted.
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof (invoice as unknown as { subscription?: unknown }).subscription === "string"
            ? ((invoice as unknown as { subscription: string }).subscription)
            : ((invoice as unknown as { subscription?: { id?: string } }).subscription?.id ?? null);
        if (!subId) {
          // Non-subscription invoice (one-off charge) — nothing to sync.
          return NextResponse.json({ received: true, ignored: "no_subscription" });
        }
        // Prefer the email already on our row (we own it, no extra Stripe
        // API call). Falls back to the invoice's customer_email field
        // which Stripe stamps from the Customer object.
        const { data: row } = await sb
          .from("pro_subscriptions")
          .select("email")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        const email =
          (row as { email?: string | null } | null)?.email ??
          invoice.customer_email?.toLowerCase() ??
          null;
        // invoice.paid → 'pro'. invoice.payment_failed → still 'pro'
        // (past_due grace), don't kick the user out preemptively. Real
        // termination flows through subscription.deleted → null.
        await syncProfilePlanByEmail(sb, email, "pro");
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
 * Rewards the referrer when a referred user makes their first payment.
 * Best-effort / non-fatal — called fire-and-forget from checkout.session.completed.
 *
 * Logic:
 *   1. Find the user by email → get signup_source
 *   2. If signup_source starts with "ref:", extract the code
 *   3. Find the referrer by referral_code
 *   4. If the referrals row has no rewarded_at yet → extend referrer plan +30 days
 */
async function rewardReferrerIfEligible(
  sb: SupabaseClient,
  email: string,
): Promise<void> {
  const userId = await findUserIdByEmail(sb, email);
  if (!userId) return;

  const { data: profile } = await sb
    .from("profiles")
    .select("signup_source")
    .eq("user_id", userId)
    .maybeSingle();

  const signupSource = (profile as { signup_source?: string | null } | null)?.signup_source ?? null;
  if (!signupSource?.startsWith("ref:")) return;

  const refCode = signupSource.slice(4);

  const { data: referrerRow } = await sb
    .from("profiles")
    .select("user_id, manual_plan_override, manual_plan_expires_at")
    .eq("referral_code", refCode)
    .maybeSingle();

  if (!referrerRow?.user_id || referrerRow.user_id === userId) return;

  const { data: referralEntry } = await sb
    .from("referrals")
    .select("id, rewarded_at")
    .eq("referred_user_id", userId)
    .maybeSingle();

  if ((referralEntry as { rewarded_at?: string | null } | null)?.rewarded_at) return;

  const refData = referrerRow as {
    user_id: string;
    manual_plan_override?: string | null;
    manual_plan_expires_at?: string | null;
  };

  const baseDate = (() => {
    if (refData.manual_plan_expires_at) {
      const d = new Date(refData.manual_plan_expires_at);
      if (d > new Date()) return d;
    }
    return new Date();
  })();
  const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  const skipOverride =
    refData.manual_plan_override === "plus" || refData.manual_plan_override === "beta";

  await sb
    .from("profiles")
    .update({
      manual_plan_override: skipOverride ? refData.manual_plan_override : "pro",
      manual_plan_expires_at: newExpiry.toISOString(),
    })
    .eq("user_id", refData.user_id);

  const rewardedAt = new Date().toISOString();
  if ((referralEntry as { id?: string } | null)?.id) {
    await sb
      .from("referrals")
      .update({ status: "rewarded", rewarded_at: rewardedAt })
      .eq("id", (referralEntry as { id: string }).id);
  } else {
    await sb.from("referrals").insert({
      referrer_user_id: refData.user_id,
      referred_user_id: userId,
      referral_code: refCode,
      status: "rewarded",
      rewarded_at: rewardedAt,
    });
  }

  // eslint-disable-next-line no-console
  console.log("[pro/webhook] referral rewarded:", {
    referrerId: refData.user_id,
    referredId: userId,
    newExpiry: newExpiry.toISOString(),
  });
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
