import { supabase } from "./supabase";
import { resetAutoFillForSignOut } from "./postMealCgmAutoFill";

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("Sign-in succeeded but no session was returned");
  return data;
}

export async function signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const needsEmailConfirmation = !data.session;
  return { needsEmailConfirmation };
}

export async function signOut() {
  if (!supabase) return;
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
