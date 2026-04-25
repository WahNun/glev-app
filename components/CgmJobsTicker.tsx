"use client";

import { useEffect, useRef } from "react";
import { processPendingJobs } from "@/lib/cgmJobs";

const TICK_MS = 5 * 60 * 1000; // 5 min

/**
 * Mounts once inside the protected layout. Runs the CGM job processor
 * on initial load (after a small delay to avoid blocking first paint),
 * then every 5 minutes while the tab is open. Also re-runs when the
 * tab regains focus, so values catch up after the laptop wakes from
 * sleep.
 *
 * Renders nothing.
 */
export default function CgmJobsTicker() {
  const ranOnceRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    function maybeRun(reason: string) {
      if (cancelled) return;
      processPendingJobs().then(res => {
        if (!res) return;
        if (res.fetched > 0 || res.failed > 0) {
          // Trigger a refresh on the entry log so newly populated values
          // show up without requiring a page reload.
          window.dispatchEvent(new CustomEvent("glev:meals-updated"));
          window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
          window.dispatchEvent(new CustomEvent("glev:exercise-updated"));
        }
        // eslint-disable-next-line no-console
        console.info("[cgm-ticker]", reason, res);
      }).catch(() => {});
    }

    // Initial run after 4s — gives the page time to mount and auth to settle.
    const initialTimer = setTimeout(() => {
      if (!ranOnceRef.current) {
        ranOnceRef.current = true;
        maybeRun("initial");
      }
    }, 4000);

    // Periodic.
    timer = setInterval(() => maybeRun("interval"), TICK_MS);

    // Re-run on tab focus (catches "laptop woke up" case).
    function onVis() {
      if (document.visibilityState === "visible") maybeRun("visibility");
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
