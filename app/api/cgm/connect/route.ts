import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authenticate } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cgm/connect
 *
 * Junction LibreView connect flow:
 *   1. Make sure the caller has a row in `profiles` and (lazily) a Junction
 *      user_id. We create the Junction user on first call so that re-pressing
 *      the button after a disconnect just re-uses the existing id.
 *   2. Mint a one-shot Junction Link token for that user_id, scoped to the
 *      `abbott_libreview` provider with a redirect back to /settings.
 *   3. Return the hosted Link URL so the client can window.location to it.
 *
 * Auth:  Junction expects `x-vital-api-key`, NOT a Bearer token (the API was
 *        rebranded from Vital → Junction; both header names work but the docs
 *        only document x-vital-api-key, so we stick with that).
 *
 * Region: the API key prefix encodes region+env: sk_/pk_ + us/eu. We pick the
 *        base URL to match. NEXT_PUBLIC_APP_URL falls back to the Replit dev
 *        domain so this works in both prod and dev without extra env setup.
 */
export async function POST(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.JUNCTION_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "JUNCTION_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const baseUrl = junctionBaseUrl(apiKey);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  if (!appUrl) {
    return NextResponse.json(
      { error: "Cannot determine app URL for redirect (set NEXT_PUBLIC_APP_URL)." },
      { status: 500 },
    );
  }
  const redirectUrl = `${appUrl}/settings?cgm=connected`;

  // SSR Supabase client tied to the caller's session — RLS will only let the
  // user read/write their OWN profiles row, which is exactly what we want.
  const cookieStore = await cookies();
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const sb = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () =>
        cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => {},
    },
  });

  // Step 1: load existing profile row. The profiles table is auto-populated
  // on auth.users insert (verified — every existing user has a row), so a
  // missing row here is unexpected; we still handle it as a hard error
  // rather than try to insert (no INSERT RLS policy exists for profiles,
  // and inserting would also need to satisfy NOT NULL `role`).
  const { data: existing, error: selErr } = await sb
    .from("profiles")
    .select("junction_user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json(
      { error: `db read failed: ${selErr.message}` },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "no profile row for this user — onboarding incomplete?" },
      { status: 500 },
    );
  }

  let junctionUserId = existing.junction_user_id ?? null;

  // Step 2: lazily create the Junction user. If we already have one, skip
  // straight to link-token generation — Junction users are durable.
  if (!junctionUserId) {
    const userRes = await fetch(`${baseUrl}/v2/user/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-vital-api-key": apiKey,
      },
      body: JSON.stringify({ client_user_id: user.id }),
    });
    const userBody = (await safeJson(userRes)) as
      | {
          user_id?: string;
          client_user_id?: string;
          detail?: unknown;
          // 400 conflict response includes the existing user_id so we can
          // recover gracefully without a second round-trip.
          status?: string;
        }
      | null;

    // Junction returns 400 with the existing user_id when client_user_id
    // already maps to a Junction user — treat that as a soft "found",
    // since it means a previous connect attempt got partway and we lost
    // local state. Anything else is a real failure.
    if (!userRes.ok) {
      const reusedId =
        userBody && typeof userBody === "object" && "user_id" in userBody
          ? (userBody as { user_id?: string }).user_id
          : undefined;
      if (userRes.status === 400 && reusedId) {
        junctionUserId = reusedId;
      } else {
        return NextResponse.json(
          {
            error: "Junction user creation failed",
            status: userRes.status,
            detail: userBody?.detail ?? userBody ?? null,
          },
          { status: 502 },
        );
      }
    } else if (!userBody?.user_id) {
      return NextResponse.json(
        { error: "Junction returned no user_id", body: userBody },
        { status: 502 },
      );
    } else {
      junctionUserId = userBody.user_id;
    }

    // Persist via UPDATE (not upsert) — the row already exists from the
    // auth-trigger and there's no INSERT RLS policy. RLS limits this to the
    // caller's own row.
    const { error: upErr } = await sb
      .from("profiles")
      .update({ junction_user_id: junctionUserId })
      .eq("user_id", user.id);
    if (upErr) {
      // We've already created the Junction user but can't save the id locally.
      // Return the id so a manual reconciliation is at least possible from
      // the logs, and surface a 500 so the client doesn't proceed to redirect.
      return NextResponse.json(
        {
          error: `db write failed: ${upErr.message}`,
          orphan_junction_user_id: junctionUserId,
        },
        { status: 500 },
      );
    }
  }

  // Step 3: mint a Link token for this user, scoped to LibreView. The token
  // is single-use and short-lived; the caller redirects to link_web_url
  // which renders Junction's hosted connect UI.
  const tokenRes = await fetch(`${baseUrl}/v2/link/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-vital-api-key": apiKey,
    },
    body: JSON.stringify({
      user_id: junctionUserId,
      provider: "abbott_libreview",
      redirect_url: redirectUrl,
    }),
  });
  const tokenBody = (await safeJson(tokenRes)) as
    | { link_token?: string; link_web_url?: string; detail?: unknown }
    | null;

  if (!tokenRes.ok || !tokenBody?.link_web_url) {
    return NextResponse.json(
      {
        error: "Junction link token generation failed",
        status: tokenRes.status,
        detail: tokenBody?.detail ?? tokenBody ?? null,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ connect_url: tokenBody.link_web_url });
}

/**
 * Pick the Junction base URL from the API-key prefix (sk_eu_*, pk_us_*, …).
 * Defaults to production-EU on unknown prefixes — that's the most likely
 * host for this codebase (German user, EU sandbox key today).
 */
function junctionBaseUrl(apiKey: string): string {
  if (apiKey.startsWith("sk_eu_")) return "https://api.sandbox.eu.junction.com";
  if (apiKey.startsWith("sk_us_")) return "https://api.sandbox.us.junction.com";
  if (apiKey.startsWith("pk_eu_")) return "https://api.eu.junction.com";
  if (apiKey.startsWith("pk_us_")) return "https://api.us.junction.com";
  return "https://api.eu.junction.com";
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
