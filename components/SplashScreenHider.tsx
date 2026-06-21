"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";

export default function SplashScreenHider() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeOutDuration: 250 });
    }
  }, []);

  return null;
}
