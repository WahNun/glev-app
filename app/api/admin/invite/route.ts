import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-Invite-Endpoint — schickt einem User eine Supabase-Invite-Email.
 *
 * Auth: Bearer-Token. Header `Authorization: Bearer <ADMIN_API_SECRET>`.
 * Nur Lucas ruft das auf (via curl oder simples Admin-UI). Kein öffentlicher
 * Zugang.
 *
 * Flow:
 *   1) POST { email } mit Bearer-Header
 *   2) Supabase verschickt Invite-Email mit Link auf /auth/confirm
 *   3) User klickt → /auth/confirm verifiziert OTP (type=invite) und zeigt
 *      direkt die Passwort-Setup-Form an (siehe app/auth/confirm/page.tsx)
 *   4) Nach Passwort-Set landet User auf /dashboard
 *
 * Beispiel-Aufruf:
 *   curl -X POST https://glev.app/api/admin/invite \
 *     -H "Authorization: Bearer <ADMIN_API_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"neuer.user@example.com"}'
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected || expected.length < 16) {
    // eslint-disable-next-line no-console
    console.error("[admin/invite] ADMIN_API_SECRET nicht oder zu kurz konfiguriert");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Bitte gültige Email-Adresse angeben." }, { status: 400 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL nicht konfiguriert" }, { status: 500 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase admin init failed";
    // eslint-disable-next-line no-console
    console.error("[admin/invite] supabaseAdmin init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl}/auth/confirm`,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[admin/invite] Supabase inviteUserByEmail failed:", error.message);
    return NextResponse.json(
      { error: error.message, code: error.status ?? null },
      { status: error.status && error.status >= 400 && error.status < 600 ? error.status : 502 },
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[admin/invite] Invite verschickt an ${email}, userId=${data?.user?.id ?? "?"}`);

  return NextResponse.json({
    success: true,
    userId: data?.user?.id ?? null,
    email,
  });
}
