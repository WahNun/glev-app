"use client";

import { useEffect, useRef } from "react";
import { fetchMeals } from "@/lib/meals";
import { restoreScheduledTimers, reconcilePendingMealsCgm } from "@/lib/postMealCgmAutoFill";

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

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("glev:meal-saved", onMealSaved);
    };
  }, []);

  return null;
}
