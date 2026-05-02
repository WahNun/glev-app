// Single source of truth for "is this an in-app route?".
//
// Used by:
//   - app/layout.tsx (SSR initial theme + pre-hydration script)
//   - middleware.ts (sets x-pathname header so SSR can branch on path)
//   - components/ThemeProvider.tsx (clamps non-app routes to dark at runtime)
//
// Marketing / public surfaces (`/`, `/blog`, `/contact`, `/legal`,
// `/brand`, `/login`, `/pro`, `/beta`, `/setup`, `/onboarding` …) are
// hard-coded to the dark theme regardless of the user's THEME cookie or
// localStorage choice — many landing components style themselves
// against fixed dark hex values, so a global Light Mode produces
// white-on-white text on those pages. The picker in /settings only
// needs to control the in-app surface.
//
// Keep the regex in sync with the segment list below. The literal
// pattern is also embedded into the pre-hydration inline script in
// `app/layout.tsx`; if you add a segment, update both.

export const APP_ROUTE_SEGMENTS = [
  "dashboard",
  "log",
  "entries",
  "insights",
  "import",
  "engine",
  "history",
  "settings",
] as const;

/**
 * Source string for the regex test. Exported so the pre-hydration inline
 * script in app/layout.tsx can build the SAME regex without importing
 * this module (it has to ship as a self-contained <script> body).
 */
export const APP_ROUTE_REGEX_SOURCE =
  `^/(?:${APP_ROUTE_SEGMENTS.join("|")})(?:/|$)`;

const APP_ROUTE_RE = new RegExp(APP_ROUTE_REGEX_SOURCE);

export function isAppRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return APP_ROUTE_RE.test(pathname);
}

/**
 * Header name used by middleware.ts to forward the request pathname to
 * server components that can't read the URL directly. Lives here (not
 * in middleware.ts) so server components don't have to import from a
 * file that runs in the edge runtime.
 */
export const PATHNAME_HEADER = "x-glev-pathname";
