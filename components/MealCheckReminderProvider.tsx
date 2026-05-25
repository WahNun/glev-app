"use client";

import { useEffect, useState } from "react";
import { initCheckReminderListener } from "@/lib/mealCheckReminders";
import BzCheckModal, { type BzCheckPayload } from "@/components/BzCheckModal";

/**
 * Mounts once at the root of the app (alongside PushNotificationsProvider)
 * and keeps a Capacitor `localNotificationActionPerformed` listener alive
 * for the lifetime of the page. When the user taps a scheduled
 * meal-timeline-check notification (native or web), the listener fires
 * `glev:meal-check-reminder` and this provider shows BzCheckModal so the
 * user can record their current blood glucose.
 *
 * No UI beyond the modal — the component renders null when the modal is
 * closed.
 */
export default function MealCheckReminderProvider() {
  const [payload, setPayload] = useState<BzCheckPayload | null>(null);

  useEffect(() => {
    // Wire up the Capacitor LocalNotifications tap listener. The cleanup
    // function returned by initCheckReminderListener removes it on unmount.
    let removeNativeListener: (() => void) | undefined;
    void initCheckReminderListener().then((cleanup) => {
      removeNativeListener = cleanup;
    });

    // Listen for the custom event dispatched by both:
    //   • the native listener (via dispatchCheckReminderEvent in mealCheckReminders.ts)
    //   • the web Notification.onclick handler (same function)
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ mealId: string; checkType: string; label?: string }>).detail;
      if (!detail?.mealId || !detail?.checkType) return;
      setPayload({
        mealId: detail.mealId,
        checkType: detail.checkType,
        label: detail.label,
      });
    };

    window.addEventListener("glev:meal-check-reminder", handleEvent);

    return () => {
      window.removeEventListener("glev:meal-check-reminder", handleEvent);
      removeNativeListener?.();
    };
  }, []);

  return (
    <BzCheckModal
      payload={payload}
      onClose={() => setPayload(null)}
    />
  );
}
