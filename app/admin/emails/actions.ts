"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "crypto";

// Admin-Auth — gleiches Bearer-Token-Cookie-Pattern wie /admin/buyers
// und /admin/drip. Alle drei Admin-Tabs teilen sich das `glev_admin_token`
// Cookie mit `path: "/admin"`, d. h. ein Login bei einem Tab gilt für
// alle. Wir duplizieren die Login/Logout-Action hier nur damit die
// Redirects nach erfolgreichem Login wieder auf /admin/emails landen,
// statt den Operator zurück auf /admin/buyers zu werfen.

const COOKIE = "glev_admin_token";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function loginAction(formData: FormData): Promise<void> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    redirect("/admin/emails?err=server");
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect("/admin/emails?err=bad");
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin/emails");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  // Cookie wurde mit `path: "/admin"` gesetzt; das Löschen muss denselben
  // Path angeben, sonst greift `delete()` nur auf den Default-Path "/"
  // und der Auth-Cookie bleibt für den /admin-Scope hängen.
  store.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  });
  redirect("/admin/emails");
}

export async function isAdminAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) return false;
  const store = await cookies();
  const tok = store.get(COOKIE)?.value ?? "";
  if (!tok) return false;
  return constantTimeEqual(tok, expected);
}
