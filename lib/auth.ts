import { supabase } from "./supabase";
import { resetAutoFillForSignOut } from "./postMealCgmAutoFill";
import { syncCachedPushToken } from "./pushNotifications";

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("Sign-in succeeded but no session was returned");
  // Re-sync push token in case the initial save failed with 401 before login.
  void syncCachedPushToken();
  return data;
}

export async function signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  // Tell Supabase where to send the confirmation-email link. Must point at
  // our /auth/callback route (which exchanges the code for a session) and
  // must also be whitelisted in Supabase Dashboard → Authentication →
  // URL Configuration → Redirect URLs.
  const emailRedirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback?lang=${
          (document.documentElement.lang || navigator.language || "").split("-")[0] === "de" ? "de" : "en"
        }`
      : undefined;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) throw error;
  const needsEmailConfirmation = !data.session;
  return { needsEmailConfirmation };
}

export async function signOut() {
  if (!supabase) return;

  // Clear the server-side push token BEFORE invalidating the session so
  // the hypo-check Edge Function stops targeting this device after logout.
  // Fire-and-forget — a network failure is non-fatal.
  try {
    await fetch("/api/profile/push-token", {
      method: "DELETE",
      credentials: "include",
    });
  } catch { /* non-fatal */ }

  // Remove the locally cached token so the next user signing in on the
  // same device starts fresh.
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("glev_push_token");
    }
  } catch { /* private mode / SSR — non-fatal */ }

  await supabase.auth.signOut();
  // Drop in-tab CGM autofill timers + cached user-id so a different account
  // signing in next does not inherit the previous user's scheduled fills.
  try { resetAutoFillForSignOut(); } catch { /* non-fatal */ }
}

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
