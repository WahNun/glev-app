"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  getLowAlarmSettings,
  persistLowAlarmSettingsLocally,
  checkAndFireIfLow,
  registerAlarmActionTypes,
  snoozeLowAlarm,
  resetSnoozeCount,
  isInSnoozeRecurrence,
  SNOOZE_ACTION_ID,
} from "@/lib/lowGlucoseAlarm";
import { getElevatedAlarmSettings, checkAndFireIfElevated, persistElevatedAlarmSettingsLocally } from "@/lib/elevatedAlarm";
import { getHyperAlarmSettings, checkAndFireIfHyper, persistHyperAlarmSettingsLocally } from "@/lib/hyperAlarm";
import { fetchLowAlarmSettingsFromDb, fetchElevatedAlarmSettingsFromDb, fetchHighAlarmSettingsFromDb } from "@/lib/userSettings";
import { useTranslations } from "next-intl";

const TICK_MS = 60 * 1000;
const LOOKBACK_MS = 20 * 60 * 1000;

/**
 * Mounts once inside the protected layout. Every minute (and on
 * initial load / tab-focus), reads the user's most recent CGM sample
 * and fires a local alarm notification if the value crosses any of the
 * three configured thresholds:
 *   • Hypo  — value < low_alarm_threshold_mgdl
 *   • Erhöht — value > elevated_alarm_threshold_mgdl
 *   • Hyper  — value > high_alarm_threshold_mgdl
 *
 * Covers both continuous-reading sources:
 *   • cgm_samples          — LLU / Nightscout users (server cron)
 *   • apple_health_readings — Apple Health users (iOS push)
 *
 * Each alarm type has its own 15-minute cooldown stored in localStorage
 * so they don't interfere with each other.
 *
 * Renders nothing.
 */
export default function LowGlucoseAlarmTicker() {
  const ranOnceRef = useRef(false);
  const t = useTranslations("low_alarm");
  const tHigh = useTranslations("elevated_alarm");
  const tHyper = useTranslations("hyper_alarm");

  const checkLatestCgm = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

      const [samplesResult, ahResult, nsResult] = await Promise.all([
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
        supabase
          .from("nightscout_readings")
          .select("value_mgdl, recorded_at")
          .eq("user_id", user.id)
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      let latestValue: number | null = null;

      const cgmTs = samplesResult.data ? new Date(samplesResult.data.timestamp).getTime() : -1;
      const ahTs  = ahResult.data      ? new Date(ahResult.data.timestamp).getTime()      : -1;
      const nsTs  = nsResult.data      ? new Date(nsResult.data.recorded_at).getTime()    : -1;

      const bestTs = Math.max(cgmTs, ahTs, nsTs);

      if (bestTs === cgmTs && cgmTs >= 0 && samplesResult.data) {
        latestValue = samplesResult.data.value_mgdl;
      } else if (bestTs === ahTs && ahTs >= 0 && ahResult.data) {
        latestValue = ahResult.data.value_mg_dl;
      } else if (bestTs === nsTs && nsTs >= 0 && nsResult.data) {
        latestValue = nsResult.data.value_mgdl;
      }

      if (latestValue == null) return;

      // ── Settings: DB-authoritative on every tick, localStorage as fallback ──
      //
      // BUG FIX (2026-06-06): The previous code relied on a one-time fire-and-
      // forget DB sync at Ticker mount + localStorage for all subsequent ticks.
      // If the mount sync failed silently (network error, cold connection) AND
      // the user had never saved settings from the Settings page, localStorage
      // had { enabled: false } (default), so the alarm was silently skipped on
      // EVERY tick — even hours later. This is a safety-critical silent miss.
      //
      // Fix: read from DB on every tick via Promise.allSettled (never throws,
      // gracefully falls back to localStorage on failure). Also persist the DB
      // result to localStorage so it's available for the fallback.
      const [lowDbResult, elevatedDbResult, hyperDbResult] = await Promise.allSettled([
        fetchLowAlarmSettingsFromDb(),
        fetchElevatedAlarmSettingsFromDb(),
        fetchHighAlarmSettingsFromDb(),
      ]);

      const lowSettings = lowDbResult.status === "fulfilled"
        ? { enabled: lowDbResult.value.enabled, thresholdMgdl: lowDbResult.value.thresholdMgdl }
        : getLowAlarmSettings();
      const elevatedSettings = elevatedDbResult.status === "fulfilled"
        ? { enabled: elevatedDbResult.value.enabled, thresholdMgdl: elevatedDbResult.value.thresholdMgdl }
        : getElevatedAlarmSettings();
      const hyperSettings = hyperDbResult.status === "fulfilled"
        ? { enabled: hyperDbResult.value.enabled, thresholdMgdl: hyperDbResult.value.thresholdMgdl }
        : getHyperAlarmSettings();

      // Keep localStorage in sync as cache for offline fallback.
      if (lowDbResult.status === "fulfilled") persistLowAlarmSettingsLocally(lowSettings);
      if (elevatedDbResult.status === "fulfilled") persistElevatedAlarmSettingsLocally(elevatedSettings);
      if (hyperDbResult.status === "fulfilled") persistHyperAlarmSettingsLocally(hyperSettings);

      // ── Alarm checks — Hypo FIRST (safety-critical, no hierarchy block) ──
      //
      // Rule: each alarm type is checked independently in its own block.
      // Hypo runs first because it is life-threatening and must never be
      // delayed by an Elevated/Hyper check, even if both thresholds are
      // crossed simultaneously. Each type has its own cooldown in localStorage
      // so they cannot block each other.

      // --- Hypo alarm (PRIORITY — runs first, independently) ---
      if (lowSettings.enabled) {
        const body = isInSnoozeRecurrence()
          ? t("snooze_notification_body", { value: latestValue, threshold: lowSettings.thresholdMgdl })
          : t("notification_body", { value: latestValue, threshold: lowSettings.thresholdMgdl });
        await checkAndFireIfLow(latestValue, lowSettings.thresholdMgdl, {
          title: t("notification_title"),
          body,
        });
      }

      // --- Elevated alarm (independent of Hypo result above) ---
      if (elevatedSettings.enabled) {
        await checkAndFireIfElevated(latestValue, elevatedSettings.thresholdMgdl, {
          title: tHigh("notification_title"),
          body: tHigh("notification_body", { value: latestValue, threshold: elevatedSettings.thresholdMgdl }),
        });
      }

      // --- Hyper alarm (independent of Hypo and Elevated results above) ---
      if (hyperSettings.enabled) {
        await checkAndFireIfHyper(latestValue, hyperSettings.thresholdMgdl, {
          title: tHyper("notification_title"),
          body: tHyper("notification_body", { value: latestValue, threshold: hyperSettings.thresholdMgdl }),
        });
      }
    } catch {
      // Never let a CGM read error surface to the user.
    }
  }, [t, tHigh, tHyper]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let removeActionListener: (() => void) | null = null;

    const snoozeTitle = t("snooze_action_title");

    registerAlarmActionTypes(snoozeTitle).catch(() => { /* ignore */ });

    // Settings are now read from DB on every tick inside checkLatestCgm()
    // via Promise.allSettled — no separate one-time sync needed here.

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
