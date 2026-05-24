"use client";

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  getLowAlarmSettings,
  checkAndFireIfLow,
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

      await checkAndFireIfLow(latestValue, thresholdMgdl, {
        title: t("notification_title"),
        body:  t("notification_body", { value: latestValue, threshold: thresholdMgdl }),
      });
    } catch {
      // Never let a CGM read error surface to the user.
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

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
      if (document.visibilityState === "visible" && !cancelled) checkLatestCgm();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [checkLatestCgm]);

  return null;
}
