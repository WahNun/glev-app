"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { initPurchases, setUserId, clearUser } from "@/lib/purchases";

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
          await setUserId(session.user.id);
          void identifyToRevenueCat(session.user.id, session.user.email);
        } else if (event === "SIGNED_OUT") {
          await clearUser();
        }
      },
    );

    // Also init immediately for already-logged-in sessions (app reopen)
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        void initPurchases(data.user.id).then(() => {
          if (data.user) {
            void setUserId(data.user.id);
            void identifyToRevenueCat(data.user.id, data.user.email);
          }
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return null;
}
