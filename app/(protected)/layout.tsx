import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Layout from "@/components/Layout";
import CgmAutoFillProvider from "@/components/CgmAutoFillProvider";
import CgmJobsTicker from "@/components/CgmJobsTicker";
import LanguageSync from "@/components/LanguageSync";

/**
 * Protected layout — server component.
 *
 * In addition to wrapping the page in the in-app chrome, this layout
 * runs a one-shot ONBOARDING GATE on every protected-route render:
 *
 *   1. middleware.ts already verified the user has a session cookie
 *      (otherwise they were 302'd to /login).
 *   2. Here we look up `profiles.onboarding_completed_at`. If NULL,
 *      we redirect to /onboarding so the user goes through the 4-step
 *      flow before seeing any product surface.
 *   3. /onboarding lives OUTSIDE the (protected) group on purpose —
 *      otherwise this gate would loop. Middleware still auth-protects
 *      it via the PROTECTED list.
 *
 * The gate is best-effort: any failure (Supabase down, migration not
 * yet applied, network blip) silently passes through to the dashboard
 * rather than locking the user out of their own data.
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  await runOnboardingGate();

  return (
    <Layout>
      <LanguageSync />
      <CgmAutoFillProvider />
      <CgmJobsTicker />
      {children}
    </Layout>
  );
}

async function runOnboardingGate(): Promise<void> {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anon) return;

  let needsOnboarding = false;
  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    if (all.length === 0) return; // no session → middleware will handle
    const sb = createServerClient(url, anon, {
      cookies: {
        getAll: () => all.map(c => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });
    const { data: userRes } = await sb.auth.getUser();
    const user = userRes?.user;
    if (!user) return;

    const { data: profile, error } = await sb
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();

    // If the column doesn't exist yet (migration not applied in this
    // env), the select itself errors — treat that as "do not gate".
    if (error) return;

    // If the profile row doesn't exist at all yet, also pass through —
    // the row will be created on first write. This avoids gating users
    // before their profile insert lands.
    if (!profile) return;

    if (profile.onboarding_completed_at == null) {
      needsOnboarding = true;
    }
  } catch {
    // Never block render on a profile-lookup failure.
    return;
  }

  if (needsOnboarding) redirect("/onboarding");
}
