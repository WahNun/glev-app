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
  appId: "app.glev",
  appName: "Glev",
  webDir: "www",
  server: {
    url: "https://glev.app",
    cleartext: false,
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
