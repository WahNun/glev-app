"use client";
import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Check for updates in the background after the SW is registered.
        // This means the next app launch gets the latest cached assets.
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // When the new SW is installed and waiting, activate it
            // immediately so the next navigation picks up fresh caches.
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch {
        // SW registration failed (private browsing, unsupported browser, etc.)
        // The app works fine without the SW — this is always a progressive enhancement.
      }
    };

    void registerSW();
  }, []);

  return null;
}
