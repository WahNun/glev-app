"use server";

import type { AdaptiveICR } from "@/lib/engine/adaptiveICR";

/**
 * Server action: emit ICR pairing stats to the server log (stdout).
 *
 * This is the server-side counterpart of the client-side computeAdaptiveICR
 * call. Because engine/page.tsx and insights/page.tsx are Client Components,
 * their console.log only appears in the browser. Callers invoke this action
 * so the pairing metrics show up in Vercel Function Logs where the
 * engineering team actually monitors them.
 *
 * The action is intentionally fire-and-forget (not awaited on the client)
 * and never throws — a logging failure must never block the UI.
 */
export async function logICRPairingStats(stats: {
  pairedCount: number;
  pairedExplicitCount: number;
  pairedTimeWindowCount: number;
  sampleSize: number;
  global: AdaptiveICR["global"];
}): Promise<void> {
  try {
    console.log(
      `[adaptiveICR][server] paired=${stats.pairedCount}` +
        ` (explicit=${stats.pairedExplicitCount}` +
        ` timeWindow=${stats.pairedTimeWindowCount})` +
        ` sampleSize=${stats.sampleSize}` +
        ` globalICR=${stats.global !== null ? stats.global.toFixed(2) : "null"}`,
    );
  } catch {
    // Logging must never crash the caller.
  }
}
