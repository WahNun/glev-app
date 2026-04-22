import { supabase } from "./supabase";

function setAuthCookie(on: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = `glev-authed=${on ? "1" : ""};path=/;max-age=${on ? 604800 : 0};SameSite=Lax`;
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setAuthCookie(true);
  return data;
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  setAuthCookie(true);
  return data;
}

export async function signOut() {
  setAuthCookie(false);
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
