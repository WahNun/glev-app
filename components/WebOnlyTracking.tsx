"use client";

import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import Script from "next/script";
import GoogleAnalytics from "./GoogleAnalytics";

export default function WebOnlyTracking({ gaId }: { gaId?: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // On SSR and before mount: render nothing (no hydration mismatch).
  // After mount: skip entirely on iOS native (Apple 5.1.2i compliance).
  if (!mounted || Capacitor.isNativePlatform()) return null;

  return (
    <>
      {gaId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script
            id="google-analytics"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaId}', { send_page_view: false });
              `,
            }}
          />
        </>
      )}
      <GoogleAnalytics />
    </>
  );
}
