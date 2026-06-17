import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { trackEvent } from "@/lib/capi-events";

/**
 * Email-confirmation / magic-link callback.
 *
 * Supabase appends `?code=…` (and optional `?next=…`) to the redirect URL
 * configured in the dashboard. We exchange the code for a session, write
 * the resulting auth cookies, and bounce the user to the requested page
 * (dashboard by default).
 *
 * IMPORTANT — Lucas must configure this URL in Supabase Dashboard →
 * Authentication → URL Configuration:
 *   - Site URL:        https://glev.app
 *   - Redirect URLs:   https://glev.app/auth/callback
 */
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const lang = searchParams.get("lang");
  const validLang = lang === "de" || lang === "en" ? lang : null;

  if (code) {
    const cookieStore = await cookies();
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => cookieStore.getAll().map(c => ({ name: c.name, value: c.value })),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // `cookies().set` throws when called from a route handler that
              // can't actually write cookies (e.g. during static generation).
              // Safe to ignore — the redirect still works for the user.
            }
          }
        },
      },
    });

    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // CAPI CompleteRegistration via Layer-One Gateway — fires for email
      // confirmation and magic-link sign-ins (not password resets).
      // event_id=signup-{userId} is stable so Webhook retries deduplicate.
      const confEmail = sessionData.session?.user?.email;
      const confUserId = sessionData.session?.user?.id;
      if (confEmail && next !== "/auth/confirm") {
        trackEvent("CompleteRegistration", {
          user: { email: confEmail, external_id: confUserId },
          eventId: `signup-${confUserId ?? confEmail}`,
          sourceUrl: `${origin}/signup`,
        }).catch(() => {});
      }

      // If coming from free-trial signup, set trial_end_at now that we have a session.
      if (next === "/onboarding" && sessionData.session?.access_token) {
        try {
          await fetch(`${origin}/api/auth/free-trial`, {
            method: "POST",
            headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          });
        } catch {
          // Non-fatal — user still gets to onboarding, trial can be set retroactively.
        }

        // If a referral cookie is present (email-confirmation flow), record the source.
        const refCookie = cookieStore.get("glev_ref")?.value;
        if (refCookie && /^[A-Z0-9]{5,10}$/.test(refCookie)) {
          try {
            await fetch(`${origin}/api/auth/signup-source`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionData.session.access_token}`,
              },
              body: JSON.stringify({ code: refCookie }),
            });
          } catch {
            // Non-fatal
          }
        }
      }
      // For password-reset flows the code is single-use and has already been
      // exchanged server-side here. Redirect to /auth/confirm WITHOUT the code
      // param so the page doesn't attempt a second (failing) exchange. Pass
      // session=ready&type=recovery so the page can skip straight to the
      // password form.
      if (next === "/auth/confirm") {
        const confirmUrl = `${origin}/auth/confirm?session=ready&type=recovery${validLang ? `&lang=${validLang}` : ""}`;
        const res = NextResponse.redirect(confirmUrl);
        if (validLang) {
          res.cookies.set("NEXT_LOCALE", validLang, {
            path: "/",
            maxAge: LOCALE_COOKIE_MAX_AGE,
            sameSite: "lax",
            secure: req.nextUrl.protocol === "https:",
          });
        }
        return res;
      }
      const res = NextResponse.redirect(`${origin}${next}`);
      if (validLang) {
        res.cookies.set("NEXT_LOCALE", validLang, {
          path: "/",
          maxAge: LOCALE_COOKIE_MAX_AGE,
          sameSite: "lax",
          secure: req.nextUrl.protocol === "https:",
        });
      }
      return res;
    }
    // eslint-disable-next-line no-console
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/auth/auth-error`);
}
