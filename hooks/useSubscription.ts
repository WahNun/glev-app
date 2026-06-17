"use client";
/**
 * useSubscription — cross-platform subscription status from Supabase (source of truth).
 *
 * Reads profiles.subscription_tier + profiles.subscription_source via /api/me/plan.
 * Does NOT read from RevenueCat CustomerInfo — RevenueCat is only the purchase gateway.
 *
 * Returns:
 *   tier   — "free" | "smart" | "pro" | "plus" | "beta" | null (loading)
 *   source — "stripe" | "apple_iap" | "google_play" | null
 *   loading
 *   setOptimisticTier — call after IAP success for instant Apple-Reviewer UX
 */

import { useEffect, useState, useCallback } from "react";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";

export type SubscriptionSource = "stripe" | "apple_iap" | "google_play" | null;

export type UseSubscriptionResult = {
  tier: EffectivePlan | null;
  source: SubscriptionSource;
  loading: boolean;
  setOptimisticTier: (tier: EffectivePlan) => void;
};

export function useSubscription(): UseSubscriptionResult {
  const [tier, setTier] = useState<EffectivePlan | null>(null);
  const [source, setSource] = useState<SubscriptionSource>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/plan", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          plan?: EffectivePlan;
          subscription_source?: string | null;
        };
        if (cancelled) return;
        setTier(data.plan ?? "free");
        const raw = data.subscription_source;
        if (raw === "stripe" || raw === "apple_iap" || raw === "google_play") {
          setSource(raw);
        } else {
          setSource(null);
        }
      })
      .catch(() => {
        if (!cancelled) setTier("free");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const setOptimisticTier = useCallback((newTier: EffectivePlan) => {
    setTier(newTier);
    setSource("apple_iap");
    setLoading(false);
  }, []);

  return { tier, source, loading, setOptimisticTier };
}
