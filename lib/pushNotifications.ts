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

/** Resets the init guard so initPushNotifications() can be called again. */
export function resetPushInit(): void {
  initStarted = false;
}
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
const PLATFORM_STORAGE_KEY = "glev_push_platform";

function persistToken(token: string, platform: "ios" | "android"): void {
  try {
    if (isBrowser()) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.localStorage.setItem(PLATFORM_STORAGE_KEY, platform);
      window.dispatchEvent(
        new CustomEvent("glev:push-token", { detail: { token } }),
      );
    }
  } catch {
    /* localStorage may be unavailable (private mode) — non-fatal. */
  }

  // Persist to the server so the hypo-check Edge Function can send
  // background pushes even when the app is closed. Fire-and-forget —
  // a failed write is non-fatal; the next registration event will retry.
  void saveTokenToServer(token, platform);
}

/**
 * Re-syncs a push token that was cached in localStorage before the user
 * was logged in. Call this immediately after a successful signIn() so
 * the token reaches Supabase even if the initial save attempt failed
 * with 401 (session not yet established at registration time).
 */
export async function syncCachedPushToken(): Promise<void> {
  if (!isBrowser()) return;
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const platform = window.localStorage.getItem(PLATFORM_STORAGE_KEY) as "ios" | "android" | null;
    if (!token || !platform) return;
    await saveTokenToServer(token, platform);
  } catch {
    /* non-fatal */
  }
}

/**
 * Sends the device push token to `PATCH /api/profile/push-token` so the
 * server-side hypo-check Edge Function can reach the device even when the
 * app is closed or backgrounded.
 *
 * Silently no-ops on web (where `platform` detection falls back to
 * "android" but the call will simply receive a 400 from the server if
 * no auth session is present — non-fatal).
 */
async function saveTokenToServer(
  token: string,
  platform: "ios" | "android",
): Promise<void> {
  if (!isBrowser()) return;
  try {
    await fetch("/api/profile/push-token", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform }),
      credentials: "include",
    });
  } catch {
    /* Network failure — non-fatal. Token is still in localStorage. */
  }
}

/**
 * Detects the current Capacitor platform ("ios" or "android").
 * Returns "android" as a safe fallback on web.
 */
function detectPlatform(): "ios" | "android" {
  if (!isBrowser()) return "android";
  const w = window as unknown as {
    Capacitor?: { getPlatform?: () => string };
  };
  const p = w.Capacitor?.getPlatform?.()?.toLowerCase();
  return p === "ios" ? "ios" : "android";
}

/** Minimal subset of the Supabase Auth interface needed for token-sync. */
type SupabaseAuthLike = {
  onAuthStateChange(
    callback: (event: string) => void,
  ): { data: { subscription: { unsubscribe: () => void } } };
};

/**
 * Registers a Supabase `onAuthStateChange` listener that calls
 * `syncCachedPushToken()` whenever a `SIGNED_IN` event fires.
 *
 * This covers both:
 *   • First-ever login (manual password entry)
 *   • Every subsequent app open (session restored from AsyncStorage)
 *
 * Returns an unsubscribe function for cleanup on component unmount.
 *
 * Extracted from `PushNotificationsProvider` so it can be unit-tested
 * without mounting a React component.
 */
export function applyAuthStateListener(auth: SupabaseAuthLike): () => void {
  const { data: { subscription } } = auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") {
      void syncCachedPushToken();
    }
  });
  return () => subscription.unsubscribe();
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

  function writeDebug(key: string, value: string): void {
    try { window.localStorage.setItem(key, value); } catch { /* non-fatal */ }
  }

  try {
    writeDebug("glev_push_step", "checkPermissions");
    let perm = await PushNotifications.checkPermissions();
    writeDebug("glev_push_perm", perm.receive);

    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      writeDebug("glev_push_step", "requestPermissions");
      perm = await PushNotifications.requestPermissions();
      writeDebug("glev_push_perm", perm.receive);
    }

    if (perm.receive !== "granted") {
      // User declined — nothing more to do. They can re-enable in OS
      // settings; the next app launch will re-check and re-register.
      writeDebug("glev_push_error", `Permission denied: ${perm.receive}. Go to iOS Settings → Glev → Notifications and enable them manually.`);
      writeDebug("glev_push_step", "denied");
      return;
    }

    writeDebug("glev_push_step", "addListeners");
    // Listeners must be attached BEFORE register() so the very first
    // `registration` event (delivered synchronously on some Android
    // OEMs) is not lost.
    const platform = detectPlatform();
    await PushNotifications.addListener("registration", (token) => {
      if (token?.value) {
        writeDebug("glev_push_step", "registered");
        persistToken(token.value, platform);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      // Most common causes:
      //   iOS: Push Notifications capability missing from App ID / provisioning profile
      //        OR aps-environment entitlement missing (requires new build)
      //   Android: missing / malformed google-services.json
      try {
        const msg = typeof err === "object" && err !== null
          ? JSON.stringify(err)
          : String(err);
        writeDebug("glev_push_error", msg);
        writeDebug("glev_push_step", "registrationError");
        console.error("[glev] push registrationError:", msg);
      } catch {
        /* non-fatal */
      }
    });

    writeDebug("glev_push_step", "register() called");
    await PushNotifications.register();
  } catch (e) {
    // This catches plugin-load failures or unexpected throws.
    // Write to localStorage so the debug section can show it.
    try {
      const msg = e instanceof Error ? e.message : String(e);
      writeDebug("glev_push_error", `catch: ${msg}`);
      writeDebug("glev_push_step", "caught");
      console.error("[glev] push init caught:", msg);
    } catch { /* non-fatal */ }
  }
}
