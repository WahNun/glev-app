import { createContext, useContext } from "react";

/**
 * When true, UpgradeGate renders children unconditionally inside
 * InsightsClusterView — cluster-level access is considered final and
 * per-card feature gates are bypassed for the visible cluster.
 */
export const InsightsGateBypassCtx = createContext(false);
export const useInsightsGateBypassed = () => useContext(InsightsGateBypassCtx);
