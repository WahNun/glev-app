"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

export interface ProCheckoutState {
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR =
  "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal.";

async function resolveOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

/**
 * Server Action used by the /pro hero form.
 *
 * Mirrors what the legacy client-side `fetch("/api/pro/checkout")` did,
 * but exposed as a `<form action={…}>` target so the form keeps working
 * even on the first paint before React hydrates (which was the
 * symptom the user reported: clicking submit while JS was still warming
 * up did a default GET reload back to /pro instead of POSTing to Stripe).
 *
 * Returning {error} surfaces inline validation/server failures to the
 * existing useActionState flow; on success we redirect server-side
 * straight to checkout.stripe.com (Stripe's session.url).
 */
export async function startProCheckout(
  _prev: ProCheckoutState | null,
  formData: FormData,
): Promise<ProCheckoutState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { error: "Bitte gib eine gültige Email-Adresse ein." };
  }

  const origin = await resolveOrigin();
  if (!origin) {
    return { error: GENERIC_ERROR };
  }

  let status = 0;
  let data: { url?: string; error?: string } = {};
  try {
    const res = await fetch(`${origin}/api/pro/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
    status = res.status;
    data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
  } catch {
    return { error: GENERIC_ERROR };
  }

  if (status === 409) {
    return {
      error:
        data.error ??
        "Diese Email hat bereits eine aktive Mitgliedschaft. Schreib uns an hello@glev.app, wenn du Hilfe brauchst.",
    };
  }
  if (status < 200 || status >= 300 || !data.url) {
    return { error: data.error ?? GENERIC_ERROR };
  }

  redirect(data.url);
}
