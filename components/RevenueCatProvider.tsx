"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { initPurchases, setUserId, clearUser, type PurchasesUserAttrs } from "@/lib/purchases";

async function fetchPurchasesAttrs(
  userId: string,
  email: string | undefined,
): Promise<PurchasesUserAttrs> {
  if (!supabase) return { email, signupSource: "app_store_organic" };
  const { data } = await supabase
    .from("profiles")
    .select("display_name, signup_source")
    .eq("user_id", userId)
    .maybeSingle();
  const profile = data as { display_name?: string | null; signup_source?: string | null } | null;
  return {
    email,
    displayName: profile?.display_name ?? undefined,
    signupSource: profile?.signup_source ?? undefined,
  };
}

async function identifyToRevenueCat(userId: string, email: string | undefined): Promise<void> {
  try {
    await fetch("/api/revenuecat/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, email }),
    });
  } catch {
    // Non-critical — attributes are cosmetic only
  }
}

/**
 * Initializes the RevenueCat SDK on native iOS when the user session is known.
 * Web no-ops. Mirrors the PushNotificationsProvider pattern:
 * - SIGNED_IN → initPurchases + logIn so RevenueCat resolves the correct customer
 * - SIGNED_OUT → logOut to anonymous customer
 *
 * Mount once at the root in app/layout.tsx (same as PushNotificationsProvider).
 */
export default function RevenueCatProvider() {
  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          await initPurchases(session.user.id);
          const attrs = await fetchPurchasesAttrs(session.user.id, session.user.email);
          await setUserId(session.user.id, attrs);
          void identifyToRevenueCat(session.user.id, session.user.email);
        } else if (event === "SIGNED_OUT") {
          await clearUser();
        }
      },
    );

    // Also init immediately for already-logged-in sessions (app reopen)
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        void initPurchases(data.user.id).then(async () => {
          if (data.user) {
            const attrs = await fetchPurchasesAttrs(data.user.id, data.user.email);
            void setUserId(data.user.id, attrs);
            void identifyToRevenueCat(data.user.id, data.user.email);
          }
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
