import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // eslint-disable-next-line no-console
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/auth/auth-error`);
}
