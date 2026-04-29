import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { PreventZoom } from "@/components/PreventZoom";

const META_PIXEL_ID = "984291337254954";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Glev",
  description: "Type 1 Diabetes insulin decision-support app",
  manifest: "/site.webmanifest",
  applicationName: "Glev",
  appleWebApp: {
    capable: true,
    title: "Glev",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale + messages are resolved server-side from the NEXT_LOCALE
  // cookie (see i18n/request.ts). NextIntlClientProvider hydrates the
  // bundle into every client component below it so useTranslations()
  // works without per-component fetches.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/* Meta Pixel — fires PageView on every route. Loaded with
            `afterInteractive` so it never blocks paint/hydration; the
            queue (`fbq.queue`) catches any track() calls made before
            the script finishes loading, so the per-page Lead /
            ViewProPage events on /beta and /pro are safe even on the
            first navigation after a cold load.

            Uses `dangerouslySetInnerHTML` rather than JSX children
            because the App Router build pipeline can mangle inline
            <Script> children during minification (children become a
            string-concat `props.children` chain, the IIFE then breaks
            on the closing brace and `window.fbq` ends up undefined in
            production). `dangerouslySetInnerHTML` ships the script
            body verbatim. */}
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
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PreventZoom />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
