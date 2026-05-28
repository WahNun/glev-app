/**
 * Single source of truth for the country-to-locale mapping used in
 * both middleware.ts (cookie persistence) and i18n/request.ts (request
 * config). Previously both files had their own copy and a "keep in sync"
 * comment — this module removes that coupling.
 */

export const DACH_COUNTRIES = new Set(["DE", "AT", "CH", "LU", "LI"]);

/**
 * Maps a raw country code (from Vercel `x-vercel-ip-country` or
 * Cloudflare `cf-ipcountry`) to the corresponding app locale.
 * Returns null when no country signal is available so the caller can
 * fall through to the next resolution strategy (cookie → Accept-Language).
 */
export function geoLocale(country: string | null | undefined): "de" | "en" | null {
  if (!country) return null;
  return DACH_COUNTRIES.has(country.toUpperCase()) ? "de" : "en";
}
