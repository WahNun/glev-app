"use client";

import { useEffect, useRef } from "react";
import { fetchMeals } from "@/lib/meals";
import { restoreScheduledTimers, reconcilePendingMealsCgm } from "@/lib/postMealCgmAutoFill";

// Apple Health sync cadence — every APPLE_HEALTH_INTERVAL_MS while the
// app is open AND the user has cgm_source = 'apple_health'. iOS HealthKit
// is read-only on-device through the Capacitor bridge — the backend can
// never reach the iPhone — so the device must push deltas itself. 5 min
// matches the sensor cadence (Libre 3 / Dexcom G7 write every 1–5 min)
// without spamming the upsert endpoint.
const APPLE_HEALTH_INTERVAL_MS = 5 * 60 * 1000;

export default function CgmAutoFillProvider() {
  const ranRef = useRef(false);
  const reconcilingRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    void restoreScheduledTimers();

    async function reconcile() {
      // In-flight guard: dev StrictMode + visibility/event listeners can
      // overlap reconcile calls. Coalesce them to a single round-trip.
      if (reconcilingRef.current) return;
      reconcilingRef.current = true;
      try {
        const meals = await fetchMeals();
        if (cancelled) return;
        const r = await reconcilePendingMealsCgm(meals);
        if (r.filled > 0 && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("glev:meals-updated", { detail: { source: "cgm-autofill-reconcile", filled: r.filled } }));
        }
      } catch { /* silent — never block UI */ }
      finally { reconcilingRef.current = false; }
    }

    reconcile();

    function onVisible() { if (document.visibilityState === "visible") reconcile(); }
    document.addEventListener("visibilitychange", onVisible);

    function onMealSaved() {
      // Trigger a slightly delayed reconcile after a save so any past-due slots
      // (e.g. when a manual entry is logged for a meal that happened > 1h ago)
      // are filled without waiting for the visibility listener.
      setTimeout(() => { if (!cancelled) reconcile(); }, 1500);
    }
    window.addEventListener("glev:meal-saved", onMealSaved);

    // Apple Health sync (iOS-only). Mounted inside this provider because
    // the provider already runs on every protected page after login —
    // exactly when we want the sync to be live. The helper below owns
    // its own teardown so the React effect just hands ownership over.
    let teardownAppleHealth = startAppleHealthSync(() => cancelled);

    // Allow the Settings card to re-arm the sync when the user switches
    // CGM source mid-session. Without this, a user who picks Apple
    // Health for the first time only gets background syncs after a full
    // page reload — the original startAppleHealthSync call already
    // bailed because cgm_source was NULL at provider mount time.
    function onSourceChanged() {
      teardownAppleHealth();
      teardownAppleHealth = startAppleHealthSync(() => cancelled);
    }
    window.addEventListener("glev:cgm-source-changed", onSourceChanged);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("glev:meal-saved", onMealSaved);
      window.removeEventListener("glev:cgm-source-changed", onSourceChanged);
      teardownAppleHealth();
    };
  }, []);

  return null;
}

/**
 * Mounts the iOS Apple Health background sync.
 *
 * Logic intentionally lives here (not inside lib/cgm/appleHealthClient)
 * so the client module stays a pure helper that can be called from
 * anywhere, and the React-lifecycle bits (interval, visibility cleanup,
 * cancellation guard) live with the provider that already owns the
 * rest of the auto-fill flow.
 *
 * Behaviour:
 *   - Bails early on non-native platforms (web preview).
 *   - Bails early if the user's cgm_source !== 'apple_health' so we
 *     don't spam the endpoint for LLU / Nightscout users.
 *   - Runs once on mount, then every APPLE_HEALTH_INTERVAL_MS, and
 *     again on every visibility=visible event (foreground from
 *     background).
 *   - Returns a teardown function the caller MUST invoke on unmount.
 */
function startAppleHealthSync(isCancelled: () => boolean): () => void {
  let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let detachVisibility: (() => void) | null = null;

  // The provider must work in SSR without crashing. Defer all dynamic
  // imports + the source-check fetch to a microtask so we never block
  // initial mount.
  void (async () => {
    if (isCancelled()) return;
    if (typeof window === "undefined") return;
    try {
      const { isNative, syncRecent } = await import("@/lib/cgm/appleHealthClient");
      if (!(await isNative())) return;
      if (isCancelled()) return;

      // Cheap source check — skip the sync entirely if the user hasn't
      // picked Apple Health. Using the lightweight /api/cgm/source
      // endpoint avoids hitting the LLU adapter on every interval tick.
      const source = await fetchCurrentSource();
      if (source !== "apple_health") return;
      if (isCancelled()) return;

      const tick = async () => {
        if (isCancelled()) return;
        try {
          await syncRecent();
        } catch {
          /* swallow — surfaced via Settings card "last sync" status */
        }
      };

      // Initial sync — short delay so we don't compete with the meal
      // reconcile fetch above for the auth cookie / connection.
      initialTimeoutId = setTimeout(() => { void tick(); }, 1500);
      intervalId = setInterval(() => { void tick(); }, APPLE_HEALTH_INTERVAL_MS);

      const onVis = () => {
        if (document.visibilityState === "visible") void tick();
      };
      document.addEventListener("visibilitychange", onVis);
      detachVisibility = () => document.removeEventListener("visibilitychange", onVis);
    } catch {
      /* dynamic import / fetch failed — silent, sync simply won't run */
    }
  })();

  return () => {
    if (initialTimeoutId) {
      clearTimeout(initialTimeoutId);
      initialTimeoutId = null;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (detachVisibility) {
      detachVisibility();
      detachVisibility = null;
    }
  };
}

async function fetchCurrentSource(): Promise<string | null> {
  try {
    const res = await fetch("/api/cgm/source", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { source?: string | null };
    return j?.source ?? null;
  } catch {
    return null;
  }
}
