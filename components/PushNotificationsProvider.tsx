"use client";

import { useEffect } from "react";
import { initPushNotifications, syncCachedPushToken } from "@/lib/pushNotifications";
import { supabase } from "@/lib/supabase";

/**
 * Mounts once at the root of the client tree and kicks off the
 * Capacitor Push Notifications registration on native shells (iOS /
 * Android). On the web (Vercel PWA, dev preview) the helper detects a
 * non-native runtime and no-ops, so this component is safe to render
 * unconditionally inside `app/layout.tsx`.
 *
 * Session-restore safety:
 *   On a native Capacitor app the user is typically already logged in
 *   when the app re-opens. The Supabase session is restored from
 *   AsyncStorage *asynchronously* — it may not be ready when the
 *   registration event fires inside initPushNotifications(). The
 *   resulting PATCH /api/profile/push-token call returns 401 and the
 *   token is silently lost. Subscribing to onAuthStateChange('SIGNED_IN')
 *   guarantees syncCachedPushToken() runs the moment the session is
 *   available, covering both:
 *     • First-ever login (manual password entry)
 *     • Every subsequent app open (session restored from storage)
 *
 * No UI — purely a side-effect provider.
 */
export default function PushNotificationsProvider() {
  useEffect(() => {
    void initPushNotifications();

    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        void syncCachedPushToken();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
