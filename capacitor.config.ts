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
    url: "https://glev.app/dashboard",
    cleartext: false,
    androidScheme: "https",
    allowNavigation: ["glev.app"],
  },
  plugins: {
    // ScreenOrientation: default portrait-lock intentionally removed.
    //
    // Previously `ScreenOrientation: { default: "portrait" }` locked the
    // entire app at the Capacitor plugin level. That prevented the
    // LandscapeGlucoseOverlay from ever receiving an orientation-change
    // event inside the WKWebView — iOS simply never rotated the view.
    //
    // Orientation control is now handled per-component in JS:
    //  - LandscapeGlucoseOverlay calls ScreenOrientation.unlock() on
    //    mount so iOS is allowed to rotate when the user tilts the phone.
    //  - When the overlay closes (landscape → portrait), it calls
    //    ScreenOrientation.lock({ orientation: "portrait" }) to restore
    //    the lock for all other screens.
    //
    // iOS-Pendant: UISupportedInterfaceOrientations in Info.plist now
    //   includes LandscapeLeft + LandscapeRight for iPhone (required;
    //   without those entries iOS ignores JS unlock calls entirely).
    //   A new Xcode archive + TestFlight build is required for that
    //   Info.plist change to take effect — npx cap sync ios is not enough.
    // Android-Pendant: android:screenOrientation="portrait" in the
    //   Manifest remains unchanged (Android task is out of scope).
    //
    // Show push notification banners even when the app is in the foreground.
    // Without this iOS suppresses banners while the app is open.
    // Requires a new native build (npx cap sync ios) to take effect.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
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
    // 2026-05-21: match the WKWebView native background to the app's
    // dark page background (#09090B). When contentInset:"always" builds
    // are still in circulation the iOS-managed safe-area zone below the
    // nav bar is painted by the native WebView background — without this
    // it defaults to black (#000000) which creates a visible strip. With
    // "never" (new builds) the WebView extends to the physical edge so
    // this value is a no-op, but harmless to keep.
    backgroundColor: "#09090B",
  },
  // 2026-06-07: explicit iOS plugin class registration for Capacitor 8.
  // Without this list, native plugins compiled into the App target
  // are not auto-discovered by the bridge and JS calls return
  // {"code":"UNIMPLEMENTED"}. Order is irrelevant. ALL native plugins
  // used by Glev — both standard Capacitor plugins AND our custom
  // inline plugin (GlevCriticalAlertsPlugin in ios/App/App/) — must be
  // listed here. Adding a new native plugin without an entry here
  // results in silent failure on iOS.
  packageClassList: [
    "HapticsPlugin",
    "LocalNotificationsPlugin",
    "PushNotificationsPlugin",
    "ScreenOrientationPlugin",
    "SharePlugin",
    "HealthPlugin",
    "GlevCriticalAlertsPlugin",
  ],
};

export default config;
