import { LAUNCH_DATE_ISO } from "@/components/landing/tokens";

/**
 * Days from `now` until the public launch date (LAUNCH_DATE_ISO, midnight UTC).
 * Returns 0 if launch is already in the past (or today).
 *
 * Used as the Stripe `trial_period_days` for /pro subscriptions so the
 * customer's card is collected at signup but the first €24.90 is only
 * charged on launch day.
 */
export function proTrialPeriodDays(now: Date = new Date()): number {
  const launch = new Date(`${LAUNCH_DATE_ISO}T00:00:00Z`);
  const diffMs = launch.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
