"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { InsightsClusterView } from "../page";
import type { InsightsCluster } from "@/types/InsightsCluster";

const VALID_CLUSTERS: InsightsCluster[] = [
  "glucose-basics",
  "meals-bolus",
  "adaptive-engine",
  "workout-activity",
  "cycle-symptoms",
];

export default function InsightsClusterPage({
  params,
}: {
  params: Promise<{ cluster: string }>;
}) {
  const { cluster } = use(params);
  const router = useRouter();
  const isValid = VALID_CLUSTERS.includes(cluster as InsightsCluster);

  useEffect(() => {
    if (!isValid) router.replace("/insights");
  }, [isValid, router]);

  if (!isValid) return null;

  return <InsightsClusterView clusterId={cluster as InsightsCluster} />;
}
