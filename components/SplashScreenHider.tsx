"use client";
import { useEffect } from "react";

async function hideSplash() {
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    // Not a Capacitor native env, or plugin not installed — ignore.
  }
}

export default function SplashScreenHider() {
  useEffect(() => {
    // Attempt 1: hide immediately on first React paint (content ready).
    void hideSplash();

    // Fallback: no matter what, force-hide after 6 seconds so a failed
    // bridge call never leaves the user stuck on a black splash screen.
    const fallback = setTimeout(() => { void hideSplash(); }, 6000);
    return () => clearTimeout(fallback);
  }, []);

  return null;
}
