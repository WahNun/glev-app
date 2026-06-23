export function trackSignupConversion(userId: string): void {
  if (typeof window === "undefined" || !window.gtag) return;

  const dedupKey = `glev_conv_signup_${userId}`;
  if (localStorage.getItem(dedupKey)) return;
  localStorage.setItem(dedupKey, Date.now().toString());

  // GA4 custom event — Google Ads importiert via GA4-Verlinkung automatisch
  window.gtag("event", "ads_conversion_SIGNUP_1", { user_id: userId });
}
