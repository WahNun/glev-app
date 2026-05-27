"use client";

/**
 * usePlan — einziger Client-seitiger Subscription-Check-Hook.
 *
 * Gibt zurück:
 *   plan          — "free" | "beta" | "pro" | "plus"
 *   trialActive   — true wenn profiles.trial_end_at in der Zukunft liegt
 *   trialEndsAt   — ISO-String oder null
 *   loading       — true während der initialen Fetch
 *   canAccess(feature) — ob der User auf ein Feature zugreifen darf
 *
 * Intern:
 *   Fetcht GET /api/me/plan (service-role read, keine RLS-Überraschungen).
 *   Cached den letzten Wert im Modul-Scope (sessionStorage-ähnlich) damit
 *   mehrere Komponenten auf derselben Seite nicht mehrere Requests auslösen.
 *   Cache wird bei window focus-refresh nicht automatisch invalidiert —
 *   das ist bewusst: Plan-Änderungen brauchen keinen Real-Time-Update.
 *
 * Verwendung:
 *   const { plan, trialActive, canAccess } = usePlan();
 *   if (!canAccess("engine_bolus_suggestion")) return <UpgradeHint />;
 */

import { useEffect, useRef, useState } from "react";
import { canAccess as canAccessFn } from "@/lib/planFeatures";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";

type PlanApiResponse = {
  plan: EffectivePlan;
  trial_active: boolean;
  trial_ends_at: string | null;
};

type UsePlanResult = {
  plan: EffectivePlan;
  trialActive: boolean;
  trialEndsAt: string | null;
  loading: boolean;
  canAccess: (feature: string) => boolean;
};

// Module-level cache — shared across all usePlan() instances on the same page.
let cache: PlanApiResponse | null = null;
let inflight: Promise<PlanApiResponse> | null = null;

async function fetchPlan(): Promise<PlanApiResponse> {
  if (inflight) return inflight;
  inflight = fetch("/api/me/plan", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`/api/me/plan ${res.status}`);
      const data = (await res.json()) as Partial<PlanApiResponse>;
      const result: PlanApiResponse = {
        plan: (data.plan as EffectivePlan) ?? "free",
        trial_active: data.trial_active ?? false,
        trial_ends_at: data.trial_ends_at ?? null,
      };
      cache = result;
      inflight = null;
      return result;
    })
    .catch((err) => {
      inflight = null;
      console.warn("[usePlan] fetch failed, falling back to free:", err);
      return { plan: "free" as EffectivePlan, trial_active: false, trial_ends_at: null };
    });
  return inflight;
}

const FREE_FALLBACK: UsePlanResult = {
  plan: "free",
  trialActive: false,
  trialEndsAt: null,
  loading: true,
  canAccess: () => true, // fail-open while loading
};

export function usePlan(): UsePlanResult {
  const [state, setState] = useState<UsePlanResult>(() => {
    if (cache) {
      return makeResult(cache, false);
    }
    return FREE_FALLBACK;
  });

  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    if (cache) {
      setState(makeResult(cache, false));
      return;
    }

    fetchPlan().then((data) => {
      setState(makeResult(data, false));
    });
  }, []);

  return state;
}

function makeResult(data: PlanApiResponse, loading: boolean): UsePlanResult {
  return {
    plan: data.plan,
    trialActive: data.trial_active,
    trialEndsAt: data.trial_ends_at,
    loading,
    canAccess: (feature: string) =>
      canAccessFn(feature, data.plan, data.trial_active),
  };
}

/**
 * Invalidiert den Modul-Cache — aufrufen nach Plan-Änderung (z.B. nach
 * erfolgreichem Stripe-Checkout) damit der nächste usePlan()-Aufruf einen
 * frischen Wert holt.
 */
export function invalidatePlanCache(): void {
  cache = null;
  inflight = null;
}
