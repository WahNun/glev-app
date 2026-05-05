"use client";

import { useEffect } from "react";
import { initPushNotifications } from "@/lib/pushNotifications";

/**
 * Mounts once at the root of the client tree and kicks off the
 * Capacitor Push Notifications registration on native shells (iOS /
 * Android). On the web (Vercel PWA, dev preview) the helper detects a
 * non-native runtime and no-ops, so this component is safe to render
 * unconditionally inside `app/layout.tsx`.
 *
 * No UI — purely a side-effect provider.
 */
export default function PushNotificationsProvider() {
  useEffect(() => {
    void initPushNotifications();
  }, []);

  return null;
}
