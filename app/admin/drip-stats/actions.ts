"use server";

// Login/logout server actions for the /admin/drip-stats page.
//
// Mirrors app/admin/buyers/actions.ts on purpose: the cookie name and
// scope ("/admin") are identical, so logging in on either page also
// authenticates the other. We only fork the actions because the
// post-submit redirect targets differ — keeping each page's form
// pointed at its own URL avoids surprising bounces.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "crypto";

const COOKIE = "glev_admin_token";
const SELF = "/admin/drip-stats";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function loginAction(formData: FormData): Promise<void> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    redirect(`${SELF}?err=server`);
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect(`${SELF}?err=bad`);
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect(SELF);
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  redirect(SELF);
}
