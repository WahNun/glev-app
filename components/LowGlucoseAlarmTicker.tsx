"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  getLowAlarmSettings,
  checkAndFireIfLow,
  registerAlarmActionTypes,
  snoozeLowAlarm,
  resetSnoozeCount,
  isInSnoozeRecurrence,
  SNOOZE_ACTION_ID,
} from "@/lib/lowGlucoseAlarm";
import { useTranslations } from "next-intl";

const TICK_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 20 * 60 * 1000;

/**
 * Mounts once inside the protected layout. Every 5 minutes (and on
 * initial load / tab-focus), reads the user's most recent CGM sample
 * and fires a local alarm notification if the value is below their
 * configured low-glucose threshold.
 *
 * Covers both continuous-reading sources:
 *   • cgm_samples          — LLU / Nightscout users (every 5min server cron)
 *   • apple_health_readings — Apple Health users (iOS push)
 *
 * The two tables are queried in parallel; we take the most recent
 * reading across both to ensure Apple Health users are covered even
 * though they never appear in cgm_samples.
 *
 * Also registers the HYPO_ALARM notification action category on native
 * (for the Snooze button), listens for the SNOOZE_15 action, and
 * resets the snooze counter whenever the app comes back to the
 * foreground (visibility change or Capacitor appStateChange).
 *
 * Renders nothing.
 */
export default function LowGlucoseAlarmTicker() {
  const ranOnceRef = useRef(false);
  const t = useTranslations("low_alarm");

  const checkLatestCgm = useCallback(async () => {
    const { enabled, thresholdMgdl } = getLowAlarmSettings();
    if (!enabled) return;
    if (!supabase) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

      const [samplesResult, ahResult] = await Promise.all([
        supabase
          .from("cgm_samples")
          .select("value_mgdl, timestamp")
          .eq("user_id", user.id)
          .gte("timestamp", since)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("apple_health_readings")
          .select("value_mg_dl, timestamp")
          .eq("user_id", user.id)
          .gte("timestamp", since)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      let latestValue: number | null = null;

      const cgmTs  = samplesResult.data ? new Date(samplesResult.data.timestamp).getTime() : -1;
      const ahTs   = ahResult.data      ? new Date(ahResult.data.timestamp).getTime()      : -1;

      if (cgmTs >= ahTs && samplesResult.data) {
        latestValue = samplesResult.data.value_mgdl;
      } else if (ahTs > cgmTs && ahResult.data) {
        latestValue = ahResult.data.value_mg_dl;
      }

      if (latestValue == null) return;

      // Use the snooze-recurrence body when we're in an active snooze
      // cycle so the user can tell this is a re-trigger, not a new event.
      const body = isInSnoozeRecurrence()
        ? t("snooze_notification_body", { value: latestValue, threshold: thresholdMgdl })
        : t("notification_body", { value: latestValue, threshold: thresholdMgdl });

      await checkAndFireIfLow(latestValue, thresholdMgdl, {
        title: t("notification_title"),
        body,
      });
    } catch {
      // Never let a CGM read error surface to the user.
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let removeActionListener: (() => void) | null = null;

    const snoozeTitle = t("snooze_action_title");

    // Register the HYPO_ALARM action category (SSR-safe, no-ops on web).
    registerAlarmActionTypes(snoozeTitle).catch(() => { /* ignore */ });

    // Listen for the Snooze button tap in the alarm notification, and
    // reset the snooze counter when the app comes back to the foreground.
    // Dynamic import keeps this SSR-safe and avoids loading Capacitor on web.
    import("@capacitor/local-notifications")
      .then(({ LocalNotifications }) => {
        if (cancelled) return;
        const handle = LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (event) => {
            if (event.actionId === SNOOZE_ACTION_ID) {
              snoozeLowAlarm(15);
            }
          },
        );
        handle.then((listener) => {
          if (cancelled) {
            listener.remove();
          } else {
            removeActionListener = () => listener.remove();
          }
        }).catch(() => { /* ignore */ });
      })
      .catch(() => { /* web or Capacitor not available — no-op */ });

    const initialTimer = setTimeout(() => {
      if (!ranOnceRef.current && !cancelled) {
        ranOnceRef.current = true;
        checkLatestCgm();
      }
    }, 6000);

    timer = setInterval(() => {
      if (!cancelled) checkLatestCgm();
    }, TICK_MS);

    function onVis() {
      if (document.visibilityState === "visible" && !cancelled) {
        // Treat the browser tab becoming visible as "app opened" —
        // resets the snooze counter so a new alarm cycle can start.
        resetSnoozeCount();
        checkLatestCgm();
      }
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      removeActionListener?.();
    };
  }, [checkLatestCgm, t]);

  return null;
}
