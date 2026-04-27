// Helpers for switching the UI locale at runtime.
//
// Strategy: the SERVER reads the locale from a `NEXT_LOCALE` cookie in
// `i18n/request.ts` and loads the corresponding messages bundle from
// `/messages/<locale>.json` at request time. So to change languages we
// must (1) write the cookie, (2) persist the choice to Supabase
// (`profiles.language`) so the user's preference survives across
// devices, and (3) trigger a full reload so the server re-runs the
// request config and ships the new bundle to the client.
//
// We intentionally use `location.reload()` rather than
// `router.refresh()` because next-intl loads messages once per request
// at the layout boundary; a soft refresh is not guaranteed to re-import
// the JSON bundle. A hard reload is also user-perceptible feedback that
// "the language switched", which is what users expect.

import { supabase } from "./supabase";

export type Locale = "de" | "en";
export const SUPPORTED_LOCALES: readonly Locale[] = ["de", "en"] as const;
export const DEFAULT_LOCALE: Locale = "de";
const COOKIE_NAME = "NEXT_LOCALE";
// One year — locale is stable, not session-bound.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  if (!match) return null;
  const v = decodeURIComponent(match[2]);
  return v === "de" || v === "en" ? v : null;
}

export function writeLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  // SameSite=Lax is fine — cookie only needs to ride first-party
  // navigations. Path=/ so every route reads the same value.
  const flags = secure ? "SameSite=Lax;Secure" : "SameSite=Lax";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(locale)};path=/;max-age=${COOKIE_MAX_AGE};${flags}`;
}

/**
 * Set the active locale: writes the cookie, persists to Supabase if a
 * user is logged in, then hard-reloads so the server picks up the new
 * messages bundle on the next request.
 *
 * Safe to call from anywhere on the client. If Supabase is unreachable
 * we still apply the cookie + reload so the language switches locally —
 * persistence will happen on the next successful update.
 */
export async function setLocale(next: Locale): Promise<void> {
  writeLocaleCookie(next);
  try {
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) {
        await supabase.from("profiles").update({ language: next }).eq("id", uid);
      }
    }
  } catch {
    // Network/profile errors must not block the language switch.
  }
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
