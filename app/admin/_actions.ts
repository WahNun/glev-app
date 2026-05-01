"use server";

// Shared admin login/logout actions.
//
// Used by the /admin index page and by the AdminNav component (logout
// button). The four per-page actions (buyers/drip/drip-stats/emails)
// still exist so that submitting a login form on those pages redirects
// the operator back to the page they were trying to reach — this module
// is for the *shared* entry point at /admin where there is no
// page-specific destination yet.
//
// Cookie name and scope ("/admin") match the per-page actions exactly,
// so a login here is recognised by every admin sub-page and vice versa.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "crypto";

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
    redirect("/admin?err=server");
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect("/admin?err=bad");
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  // Cookie was set with `path: "/admin"`. Setting maxAge: 0 with the
  // same path is the only way to actually evict it — `store.delete()`
  // only targets the default "/" path and would leave the auth cookie
  // hanging in the /admin scope (same fix that emails/actions.ts uses).
  store.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 0,
  });
  redirect("/admin");
}
