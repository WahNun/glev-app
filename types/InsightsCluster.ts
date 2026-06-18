import type { FeatureTier } from "@/lib/planFeatures";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";
import { canAccess } from "@/lib/planFeatures";

export type InsightsCluster =
  | "glucose-basics"
  | "meals-bolus"
  | "adaptive-engine"
  | "workout-activity"
  | "cycle-symptoms";

export type ClusterConfig = {
  id: InsightsCluster;
  /** Display label shown in the cluster section header. */
  label: string;
  /** Accent color used for the overview card tint. */
  tint: string;
  /** Minimum tier required to view the cluster's cards. */
  requiresTier: FeatureTier;
  /** Ordered card IDs belonging to this cluster. */
  cardIds: string[];
};

export const CLUSTER_CONFIGS: ClusterConfig[] = [
  {
    id: "glucose-basics",
    label: "Glukose-Basics",
    tint: "#4F6EF7",
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
    id: "meals-bolus",
    label: "Mahlzeiten & Bolus",
    tint: "#22D3A0",
    requiresTier: "pro",
    cardIds: [
      "meal-evaluation",
      "post-bolus-trend",
      "tdd",
      "meal-type",
      "time-of-day",
      "performance-tiles",
    ],
  },
  {
    id: "adaptive-engine",
    label: "Adaptiver Engine",
    tint: "#FF9500",
    requiresTier: "pro",
    cardIds: [
      "adaptive-engine",
      "patterns",
    ],
  },
  {
    id: "workout-activity",
    label: "Workout",
    tint: "#a78bfa",
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
    id: "cycle-symptoms",
    label: "Zyklus & Schlaf",
    tint: "#FF2D78",
    requiresTier: "all",
    cardIds: ["cycle-symptoms"],
  },
];

/**
 * Returns true only for the Workout cluster (Plus-only).
 * All other clusters use per-card UpgradeGate wrappers instead.
 */
export function isClusterLocked(
  cluster: ClusterConfig,
  plan: EffectivePlan,
  trialActive: boolean,
): boolean {
  if (cluster.requiresTier !== "plus") return false;
  return !canAccess("insights_workout_cluster", plan, trialActive);
}
