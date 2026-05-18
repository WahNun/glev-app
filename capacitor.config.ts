import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the live https://glev.app web build inside a thin
 * native shell for iOS and Android. We use `server.url` mode so that
 * every release of the Vercel-hosted web app is automatically picked
 * up by the installed apps — no rebuild or App Store / Play Store
 * resubmission required for content updates.
 *
 * `webDir` still has to exist (Capacitor copies it into the native
 * project at sync time) but its contents are never loaded at runtime
 * because `server.url` overrides the local index. We ship a tiny
 * `www/index.html` placeholder for offline fallback and to satisfy
 * the CLI's checks.
 *
 * Native build prerequisites are documented in `replit.md` → "Native
 * (Capacitor)".
 */
const config: CapacitorConfig = {
  appId: "com.glev.app",
  appName: "Glev",
  webDir: "www",
  server: {
    url: "https://glev.app",
    cleartext: false,
    androidScheme: "https",
  },
  ios: {
    // 2026-05-18: switched from "always" → "never" so the WKWebView
    // fills the ENTIRE screen including the home-indicator + status-bar
    // zones, and CSS `env(safe-area-inset-{top,bottom})` returns the
    // real notch / home-indicator insets. With "always" iOS pre-pads
    // the scroll view and reports inset = 0 to CSS — that's why the
    // bottom nav floated above the home indicator with blank space
    // below, and why the header looked dramatically taller than the
    // footer (only the header reserved sa-top in CSS, footer had no
    // sa-bottom to reserve). Header + footer now both extend through
    // their respective safe-area zones with content padded inside.
    contentInset: "never",
  },
};

export default config;
