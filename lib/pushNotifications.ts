/**
 * Capacitor Push Notifications bootstrap.
 *
 * Mirrors the SSR-safe / browser-safe pattern from `lib/haptics.ts`:
 * we only touch the native plugin when the app is actually running
 * inside the iOS / Android Capacitor shell. In a regular browser tab
 * (Vercel-hosted glev.app PWA, dev preview, server-side render) the
 * helpers no-op, because Capacitor's `PushNotifications` plugin is
 * native-only and would throw on import-time access to `Capacitor.Plugins`
 * without the corresponding native binding.
 *
 * Wiring overview:
 *   1. Native shell wakes the WebView and Next.js loads `https://glev.app`.
 *   2. `<PushNotificationsProvider>` mounts client-side and calls
 *      `initPushNotifications()` exactly once.
 *   3. We request permission, register with FCM (Android) / APNs (iOS),
 *      and stash the device token under `glev_push_token` in
 *      localStorage so a future `/api/push/register` route can pick it
 *      up. Sending tokens to the backend is intentionally NOT done here
 *      — the task is "freischalten" (unlock the channel); per-user
 *      token registration is a follow-up once the backend route exists.
 *
 * On Android this requires `android/app/google-services.json` to be
 * present at native build time (see `android/SIGNING_SETUP.md`).
 * Without that file the `com.google.gms.google-services` Gradle plugin
 * is skipped and `register()` will fail at runtime with
 * "Push Notifications not enabled" — which we swallow silently so the
 * app keeps working.
 */

type PushModule = typeof import("@capacitor/push-notifications");

let initStarted = false;
let isNativeCache: boolean | undefined;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isNativePlatform(): boolean {
  if (isNativeCache !== undefined) return isNativeCache;
  if (!isBrowser()) {
    isNativeCache = false;
    return false;
  }
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  isNativeCache = !!w.Capacitor?.isNativePlatform?.();
  return isNativeCache;
}

async function loadPlugin(): Promise<PushModule | null> {
  if (!isNativePlatform()) return null;
  try {
    return await import("@capacitor/push-notifications");
  } catch {
    return null;
  }
}

const TOKEN_STORAGE_KEY = "glev_push_token";

function persistToken(token: string): void {
  try {
    if (isBrowser()) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.dispatchEvent(
        new CustomEvent("glev:push-token", { detail: { token } }),
      );
    }
  } catch {
    /* localStorage may be unavailable (private mode) — non-fatal. */
  }
}

/**
 * Idempotent. Safe to call multiple times — the native plugin's
 * `register()` is itself idempotent, but we also guard with
 * `initStarted` so the listeners are only attached once per page load.
 */
export async function initPushNotifications(): Promise<void> {
  if (initStarted) return;
  initStarted = true;

  const mod = await loadPlugin();
  if (!mod) return;

  const { PushNotifications } = mod;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      // User declined — nothing more to do. They can re-enable in OS
      // settings; the next app launch will re-check and re-register.
      return;
    }

    // Listeners must be attached BEFORE register() so the very first
    // `registration` event (delivered synchronously on some Android
    // OEMs) is not lost.
    await PushNotifications.addListener("registration", (token) => {
      if (token?.value) persistToken(token.value);
    });

    await PushNotifications.addListener("registrationError", () => {
      // Most common cause on Android: missing / malformed
      // google-services.json. Swallow silently — the WebView app keeps
      // working without push.
    });

    await PushNotifications.register();
  } catch {
    /* Plugin not available on this platform — non-fatal. */
  }
}
