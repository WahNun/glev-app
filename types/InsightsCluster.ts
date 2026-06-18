import type { FeatureTier } from "@/lib/planFeatures";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";
import { canAccess } from "@/lib/planFeatures";

export type InsightsCluster = "glucose" | "patterns" | "workout" | "sleep";

export type ClusterConfig = {
  id: InsightsCluster;
  /** Display label shown in the cluster section header. */
  label: string;
  /** Minimum tier required to view the cluster's cards. */
  requiresTier: FeatureTier;
  /** Ordered card IDs belonging to this cluster. */
  cardIds: string[];
};

export const CLUSTER_CONFIGS: ClusterConfig[] = [
  {
    id: "glucose",
    label: "Glukose",
    requiresTier: "pro",
    cardIds: [
      "time-in-range",
      "gmi-a1c",
      "glucose-trend",
      "hypo-events",
      "hyper-events",
      "glucose-variability",
    ],
  },
  {
    id: "patterns",
    label: "Muster",
    requiresTier: "pro",
    cardIds: [
      "meal-evaluation",
      "post-bolus-trend",
      "adaptive-engine",
      "tdd",
      "patterns",
      "meal-type",
      "time-of-day",
      "performance-tiles",
    ],
  },
  {
    id: "workout",
    label: "Workout",
    requiresTier: "plus",
    cardIds: [
      "workout-outcomes",
      "workout-bg-response",
      "workout-patterns",
      "workout-type-patterns",
      "daily-steps",
      "active-day-outcomes",
    ],
  },
  {
    id: "sleep",
    label: "Schlaf & Zyklus",
    requiresTier: "all",
    cardIds: ["cycle-symptoms"],
  },
];

/**
 * Returns true only for clusters that need a cluster-level lock UI.
 *
 * Glucose and Patterns have per-card UpgradeGate wrappers already — showing
 * a redundant cluster-level blur on top would create Plus vs Pro confusion
 * (ABBRUCH condition). Only the Workout cluster (Plus-only, no per-card gates)
 * gets the cluster-level lock.
 */
export function isClusterLocked(
  cluster: ClusterConfig,
  plan: EffectivePlan,
  trialActive: boolean,
): boolean {
  if (cluster.requiresTier !== "plus") return false;
  return !canAccess("insights_workout_cluster", plan, trialActive);
}
