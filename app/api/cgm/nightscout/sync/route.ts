/**
 * POST /api/cgm/nightscout/sync
 *
 * Combined "set credentials + verify + return latest" for the Settings
 * page. Mirrors the LibreLinkUp /api/cgm/credentials POST → /api/cgm/latest
 * pair, but as a single round-trip because Nightscout's auth is just a
 * URL+token (no session token to cache, no LLU regional redirects to
 * resolve), so there's nothing to gain from splitting.
 *
 * Body:
 *   { url: string, token?: string | null }
 *     url   — base URL, e.g. https://mynightscout.fly.dev (trailing slash
 *             stripped server-side). Required.
 *     token — Nightscout API token (URL-safe string from the Nightscout
 *             admin UI). Optional — public test instance
 *             https://cgm-remote-monitor.nightscout.me works without one.
 *
 * Behaviour:
 *   1. Authenticate the caller via existing /api/cgm/_helpers helper.
 *   2. Probe upstream FIRST (verifyCredentials) so a bad URL/token never
 *      writes to the DB — same fail-fast contract as the LLU flow.
 *   3. Persist URL + (encrypted) token on profiles.
 *   4. Return { connected: true, current: Reading | null } so the UI can
 *      show "✓ Verbunden — letzter Wert: X mg/dL" immediately.
 *
 * Errors propagate via errResponse (401 → bad token, 502 → upstream
 * unreachable, 504 → timeout) so the existing settings-card error
 * rendering covers them.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate, errResponse } from "../../_helpers";
import {
  getCredentials,
  setCredentials,
  verifyCredentials,
} from "@/lib/cgm/nightscout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  url?: unknown;
  token?: unknown;
}

export async function POST(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url : "";
  // Empty / whitespace-only token = "no token supplied THIS time".
  // We resolve below: if the user already has a saved token, keep it;
  // otherwise the connection is genuinely unauthenticated. This lets
  // the Settings UI re-submit the form (e.g. to update the URL) without
  // forcing the user to re-paste the token every edit.
  const submittedToken =
    typeof body.token === "string" && body.token.trim().length > 0
      ? body.token.trim()
      : null;

  try {
    let effectiveToken = submittedToken;
    if (effectiveToken == null) {
      const existing = await getCredentials(user.id);
      if (existing?.token) effectiveToken = existing.token;
    }

    // Probe FIRST — never persist a URL we can't reach.
    const probe = await verifyCredentials(url, effectiveToken);
    await setCredentials(user.id, { url, token: effectiveToken });
    return NextResponse.json({
      connected: true,
      current: probe.current,
    });
  } catch (e) {
    return errResponse(e);
  }
}

/**
 * DELETE /api/cgm/nightscout/sync
 *
 * Clears the user's Nightscout connection (URL + token). Symmetric with
 * the LLU disconnect flow. The Settings page's "Trennen" button posts
 * here; profile row stays so other connections (Junction, LLU) survive.
 */
export async function DELETE(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  try {
    const { clearCredentials } = await import("@/lib/cgm/nightscout");
    await clearCredentials(user.id);
    return NextResponse.json({ connected: false });
  } catch (e) {
    return errResponse(e);
  }
}

/**
 * GET /api/cgm/nightscout/sync
 *
 * Lightweight "is the user connected to Nightscout?" probe for the
 * Settings page on mount. Returns connected:true and the URL (no token)
 * so the form can pre-fill the URL field; the token field stays empty
 * since we never expose plaintext.
 */
export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json(
      { error: authErr || "unauthorized" },
      { status: 401 }
    );
  }
  try {
    const { getCredentials } = await import("@/lib/cgm/nightscout");
    const creds = await getCredentials(user.id);
    if (!creds) return NextResponse.json({ connected: false, url: null });
    return NextResponse.json({
      connected: true,
      url: creds.url,
      // Surface "has a token configured?" without leaking the token itself,
      // so the form can show a placeholder like "•••••••• (gespeichert)".
      hasToken: !!creds.token,
    });
  } catch (e) {
    return errResponse(e);
  }
}
