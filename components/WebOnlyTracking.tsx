"use client";

import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import Script from "next/script";
import GoogleAnalytics from "./GoogleAnalytics";

const META_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID ?? "1388009386583284";

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
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');
          `,
        }}
      />
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
      <GoogleAnalytics />
    </>
  );
}
