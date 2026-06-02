// Helpers for switching the UI theme at runtime.
//
// Three user choices:
//   - "dark"   — the original Glev cockpit look (default for legacy users)
//   - "light"  — Task #38 light skin
//   - "system" — follow the OS / browser preference at apply time
//
// The chosen value is persisted in two places:
//   1. A `THEME` cookie (so the SSR pre-hydration script in app/layout.tsx
//      can resolve it before the first paint and avoid a flash of wrong
//      theme on reload).
//   2. localStorage under `glev_theme` as a fast client-side cache and a
//      browser-session source of truth — useful for the system-listener
//      (matchMedia) which only needs to read the choice, not the cookie.
//
// The script that runs pre-hydration in layout.tsx is intentionally
// duplicated inline (it must execute before React) — keep this module and
// that script in sync if you change the cookie name or the resolution
// rules.

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_COOKIE = "THEME";
export const THEME_STORAGE_KEY = "glev_theme";
// One year — theme is a stable preference, not session-bound.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_THEME_CHOICE: ThemeChoice = "system";
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = "dark";

function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "dark" || v === "light" || v === "system";
}

export function readThemeCookie(): ThemeChoice | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${THEME_COOKIE}=([^;]*)`));
  if (!match) return null;
  const v = decodeURIComponent(match[2]);
  return isThemeChoice(v) ? v : null;
}

export function writeThemeCookie(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const flags = secure ? "SameSite=Lax;Secure" : "SameSite=Lax";
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(choice)};path=/;max-age=${COOKIE_MAX_AGE};${flags}`;
}

export function readStoredChoice(): ThemeChoice {
  // Cookie wins (it's what the SSR script reads). localStorage is a
  // backwards-compatible fallback if the cookie was lost (e.g. the user
  // wiped cookies but kept site data).
  const fromCookie = readThemeCookie();
  if (fromCookie) return fromCookie;
  if (typeof window === "undefined") return DEFAULT_THEME_CHOICE;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(v)) return v;
  } catch {
    // Storage may be disabled (Safari private mode) — fall through.
  }
  return DEFAULT_THEME_CHOICE;
}

export function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DEFAULT_RESOLVED_THEME;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return resolveSystemTheme();
  return choice;
}

/**
 * Apply a theme to the live document (no reload). Sets `data-theme` on
 * <html> so the CSS variables in globals.css cascade through, and updates
 * the browser-chrome theme-color meta tag so the iOS / Android status bar
 * tint matches.
 */
export function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  // Match the viewport themeColor so the iOS PWA status bar / Android
  // address bar tint flips with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "light" ? "#FAFAFB" : "#0A0A0F");
  }
}

/**
 * Persist the user's choice and apply it immediately. No page reload —
 * unlike locale (which needs the server to reload its messages bundle),
 * the theme switch is purely a CSS-variable swap and works in-place.
 */
export function setTheme(choice: ThemeChoice) {
  writeThemeCookie(choice);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Ignore storage errors — cookie is the canonical source.
    }
  }
  applyTheme(resolveTheme(choice));
}
