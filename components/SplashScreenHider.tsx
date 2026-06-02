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

    // Fallback: force-hide after 1.5 s max — the bootstrap script in
    // layout.tsx already calls hide() at document-start, so this is only
    // a last-resort safety net for edge cases (e.g. bridge not yet ready).
    const fallback = setTimeout(() => { void hideSplash(); }, 1500);
    return () => clearTimeout(fallback);
  }, []);

  return null;
}
