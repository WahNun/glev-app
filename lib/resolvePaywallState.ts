"use client";
import {
  Purchases,
  INTRO_ELIGIBILITY_STATUS,
  type CustomerInfo,
} from "@revenuecat/purchases-capacitor";

export type PaywallState =
  | "subscribed"
  | "supabase_trial_active"
  | "eligible_for_trial"
  | "ineligible";

/**
 * Determines the correct paywall state before rendering trial CTAs.
 *
 * Priority order:
 * 1. Active RC entitlement → "subscribed" (already paying, hide paywall)
 * 2. Active Supabase trial → "supabase_trial_active" (Meta Lead trial running)
 * 3. Apple IAP trial eligibility → "ineligible" | "eligible_for_trial"
 *
 * Fails open: any error in checkTrialOrIntroductoryPriceEligibility returns
 * "eligible_for_trial" so we never silently block a legitimate purchase.
 */
export async function resolvePaywallState(
  customerInfo: CustomerInfo,
  trialActive: boolean,
  productIds: string[],
): Promise<PaywallState> {
  const active = customerInfo.entitlements.active;
  if (active.glev_smart || active.glev_pro || active.glev_plus) {
    return "subscribed";
  }

  if (trialActive) {
    return "supabase_trial_active";
  }

  if (productIds.length === 0) {
    return "eligible_for_trial";
  }

  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility({
      productIdentifiers: productIds,
    });
    const anyIneligible = Object.values(result).some(
      (e) => e.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
    );
    return anyIneligible ? "ineligible" : "eligible_for_trial";
  } catch {
    return "eligible_for_trial";
  }
}
