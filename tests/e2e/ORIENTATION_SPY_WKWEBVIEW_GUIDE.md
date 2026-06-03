# Screen-Orientation Spy — WKWebView Validation Guide

This document explains the bridge-initialisation differences between headless
Chromium (where the Playwright tests run) and a real iOS WKWebView, and
provides the exact steps to validate the spy intercept on a Mac with Xcode.

---

## Background: what was fixed

All three tests in describe block 4 of
`tests/e2e/landscape-glucose-overlay.spec.ts` were failing in headless Chromium.
Root cause: a chicken-and-egg deadlock specific to Chromium.

### The deadlock (Chromium only)

```
loadScreenOrientation()
  └─ isNativePlatformForOrientation()
       └─ window.Capacitor?.isNativePlatform?.()
            └─ undefined  ← isNativePlatform not yet set by Capacitor IIFE
  → returns false → loadScreenOrientation returns null → spy never fires
```

`window.Capacitor.isNativePlatform` is only added by the `@capacitor/core` IIFE.
That IIFE only runs when `@capacitor/screen-orientation` is dynamically imported.
That import only fires when `isNativePlatformForOrientation()` already returns
`true`. In Chromium, neither `webkit.messageHandlers.bridge` nor `androidBridge`
is present, so the IIFE would have set `isNativePlatform = () => false` anyway —
making the deadlock permanent.

### The fix (three stubs in addInitScript)

```
0. window.CapacitorCustomPlatform = { name: "ios" }
   → Capacitor reads this inside createCapacitor() (highest priority).
   → After IIFE runs: isNativePlatform() returns "ios" !== "web" = true.

1. cap.isNativePlatform = () => true
   → Breaks the deadlock BEFORE the IIFE runs.
   → Triggers the dynamic import → IIFE runs → overwrites with its own
     version (which still returns true thanks to stub 0).

2. cap.PluginHeaders + cap.nativePromise spy
   → These were already in the original test — they remain correct.
   → PluginHeaders tells registerPlugin() to route unlock()/lock() through
     nativePromise instead of the JS web implementation.
   → nativePromise spy is NOT overwritten by createCapacitor() (verified by
     reading @capacitor/core/dist/capacitor.js).
```

### Why WKWebView is different

On a real iOS device or Simulator, the native host (WKWebView) injects
`webkit.messageHandlers.bridge` into the JavaScript context before any
page scripts run. The Capacitor IIFE reads this and sets platform = "ios"
automatically. Result:

- Stub 0 (`CapacitorCustomPlatform`) is **not needed** on WKWebView.
- Stub 1 (`cap.isNativePlatform = () => true`) is **not needed** on WKWebView.
- Stubs 2 (`PluginHeaders` + `nativePromise` spy) **are still needed** on
  WKWebView — they route plugin calls through our spy instead of the real
  native bridge.

---

## Manual validation on a Mac with Xcode

### Prerequisites

- macOS with Xcode installed
- Project at `/Users/lucas/Documents/glev-app`
- iOS Simulator available (any iPhone, iOS 16+)

### Option A — validate via console logging in Simulator

1. In `components/LandscapeGlucoseOverlay.tsx`, temporarily add `console.log`
   calls around the orientation calls (revert after testing):

   ```ts
   // In the mount useEffect:
   const so = await loadScreenOrientation();
   if (!so) {
     console.log("[orient-test] loadScreenOrientation returned null — not native?");
     return;
   }
   console.log("[orient-test] unlock() about to fire");
   await so.ScreenOrientation.unlock();
   console.log("[orient-test] unlock() resolved");
   ```

2. Change `capacitor.config.ts` server.url to point to your local dev server:

   ```ts
   server: {
     url: "http://localhost:5000",  // or your Mac's LAN IP
     cleartext: true,
   }
   ```

3. Run the Next.js dev server:
   ```
   cd /Users/lucas/Documents/glev-app
   npm run dev
   ```

4. Sync and run in Simulator:
   ```
   cd /Users/lucas/Documents/glev-app
   npx cap sync ios
   npx cap run ios --target <simulator-target-id>
   ```
   Or open Xcode: `npx cap open ios` → select Simulator → ▶ Run.

5. Navigate to the login page in the Simulator, then check Xcode console.
   Expected output:
   ```
   [orient-test] unlock() about to fire
   [orient-test] unlock() resolved
   ```

6. Rotate Simulator to landscape (Hardware → Rotate Left or right).
   Check that the landscape overlay appears.

7. Rotate back to portrait.
   Expected console output:
   ```
   [orient-test] lock() about to fire    ← add similarly
   [orient-test] lock() resolved
   ```

8. Revert the temporary `console.log` changes and the `server.url` change.

### Option B — check Playwright describe block 4 passes after the fix

The three headless Chromium tests now all pass after the fix:

```
cd /Users/lucas/Documents/glev-app
npx playwright test landscape-glucose-overlay.spec.ts --grep "screen-orientation" --reporter=list
```

Expected output:
```
✓ [chromium] LandscapeGlucoseOverlay — screen-orientation API calls
    › unlock() is called on mount when Capacitor is native
✓ [chromium] LandscapeGlucoseOverlay — screen-orientation API calls
    › lock(portrait) is called when rotating back to portrait in native context
✓ [chromium] LandscapeGlucoseOverlay — screen-orientation API calls
    › no orientation API calls fire in a plain browser (isNativePlatform = false)
  3 passed
```

---

## Summary of bridge-initialisation timing differences

| Property | Headless Chromium | Real WKWebView |
|---|---|---|
| `webkit.messageHandlers.bridge` | absent | injected by native host |
| `window.androidBridge` | absent | absent |
| `CapacitorCustomPlatform` stub needed | **yes** (in addInitScript) | no |
| `isNativePlatform()` stub needed | **yes** (to break deadlock) | no |
| `PluginHeaders` stub needed | yes | yes |
| `nativePromise` spy needed | yes | yes (routes away from real bridge) |
| Spy survives Capacitor IIFE | yes (IIFE mutates existing object) | yes |
| `isNativePlatform()` post-IIFE result | `"ios" !== "web"` = true | `"ios" !== "web"` = true |

The key insight: **the spy logic is correct for both environments**. The deadlock
was a Chromium-specific test setup gap, not a component bug. On WKWebView,
`webkit.messageHandlers.bridge` replaces stubs 0 and 1 automatically.
