"use client";
import { useEffect } from "react";

export default function SplashScreenHider() {
  useEffect(() => {
    import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => {
        SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  return null;
}
