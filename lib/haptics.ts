/**
 * Centralized haptic-feedback wrapper used by all log screens (Bolus,
 * Glukose, Mahlzeit, Übung, Zyklus, Symptome). On iOS / Android we
 * delegate to `@capacitor/haptics`; in a regular browser we fall back
 * to `navigator.vibrate` with sensible durations; in SSR / Node we
 * simply no-op so the helper is safe to import from any client / server
 * boundary.
 *
 * Each public helper is a fire-and-forget — failures are swallowed
 * silently because haptics are a "nice to have", and any thrown error
 * (e.g. user disabled vibration permission, browser without API) must
 * never break the underlying user action (save, slider stop, …).
 */

type HapticsModule = typeof import("@capacitor/haptics");

let hapticsCache: HapticsModule | null | undefined;
let isNativeCache: boolean | undefined;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function isNativePlatform(): boolean {
  if (isNativeCache !== undefined) return isNativeCache;
  if (!isBrowser()) {
    isNativeCache = false;
    return false;
  }
  // Capacitor injects this global on real native shells (iOS / Android).
  // It's `undefined` in plain browser tabs, including the Vercel-hosted
  // glev.app PWA — there we'll use the navigator.vibrate fallback.
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  isNativeCache = !!w.Capacitor?.isNativePlatform?.();
  return isNativeCache;
}

async function loadHaptics(): Promise<HapticsModule | null> {
  if (hapticsCache !== undefined) return hapticsCache;
  if (!isNativePlatform()) {
    hapticsCache = null;
    return null;
  }
  try {
    hapticsCache = await import("@capacitor/haptics");
    return hapticsCache;
  } catch {
    hapticsCache = null;
    return null;
  }
}

function vibrateFallback(ms: number | number[]): void {
  if (!isBrowser()) return;
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    // Some browsers throw if the user gesture context is missing — ignore.
  }
}

/** Tiny tap — used for selection toggles, slider snap-stops, chip taps. */
export function hapticLight(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.impact({ style: h.ImpactStyle.Light }); } catch { /* noop */ }
    } else {
      vibrateFallback(10);
    }
  })();
}

/** Stronger tap — used for primary action presses (save tap-down). */
export function hapticMedium(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.impact({ style: h.ImpactStyle.Medium }); } catch { /* noop */ }
    } else {
      vibrateFallback(20);
    }
  })();
}

/** Selection feedback — segmented controls, dropdowns, multi-pick chips. */
export function hapticSelection(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.selectionChanged(); } catch { /* noop */ }
    } else {
      vibrateFallback(8);
    }
  })();
}

/** Success — fired after a successful save. */
export function hapticSuccess(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.notification({ type: h.NotificationType.Success }); } catch { /* noop */ }
    } else {
      vibrateFallback([15, 40, 25]);
    }
  })();
}

/** Warning — value outside target range, retroactive boundary, etc. */
export function hapticWarning(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.notification({ type: h.NotificationType.Warning }); } catch { /* noop */ }
    } else {
      vibrateFallback([20, 50, 20]);
    }
  })();
}

/** Error — validation failure / save failed. */
export function hapticError(): void {
  void (async () => {
    const h = await loadHaptics();
    if (h) {
      try { await h.Haptics.notification({ type: h.NotificationType.Error }); } catch { /* noop */ }
    } else {
      vibrateFallback([30, 60, 30, 60, 30]);
    }
  })();
}
