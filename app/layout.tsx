import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import "./globals.css";
import { PreventZoom } from "@/components/PreventZoom";
import { Analytics } from "@vercel/analytics/next";
import PushNotificationsProvider from "@/components/PushNotificationsProvider";
import MealCheckReminderProvider from "@/components/MealCheckReminderProvider";
import LandscapeGlucoseOverlay from "@/components/LandscapeGlucoseOverlay";
import { ThemeProvider } from "@/components/ThemeProvider";
import CookieBanner from "@/components/CookieBanner";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const META_PIXEL_ID = "960780236789931";

// Single inline bootstrap script that runs BEFORE React hydrates.
// Merged into ONE tag deliberately: Replit's devtools proxy intercepts
// the first <script> in <head> and replaces it with its own script.
// Having two separate tags causes a structural DOM mismatch (the proxy
// shifts node positions, so React finds the safe-area script at the
// wrong index). A single merged script means there is only one target
// for the proxy — React reconciles exactly one child and the
// suppressHydrationWarning on it covers the proxy replacement.
// In production (Vercel) the proxy doesn't run, so the full script
// executes normally.
//
// Part 1: Theme bootstrap — reads THEME cookie / localStorage /
// OS-preference, sets data-theme on <html> so the first painted frame
// already has the right CSS variables (no FOUC). Theme is now honoured
// on ALL routes (marketing + app alike) — Task #134 wired up Light Mode
// across all public pages so the old "marketing always dark" rule is gone.
//
// Part 2: Safe-area measurement — measures env(safe-area-inset-bottom)
// via a sentinel element and writes --safe-bottom onto <html> so the
// footer always covers the home indicator on Capacitor/WKWebView, even
// when env() returns 0. Re-measures on resize / orientation-change.
const BOOTSTRAP_SCRIPT = `
(function(){
  // Recovery-hash guard (runs BEFORE the app bundle, so before the Supabase
  // client's detectSessionInUrl can consume/strip the hash on /login or /).
  // Supabase Implicit Flow appends the session as a URL hash:
  //   …#access_token=…&type=recovery|invite|signup  (or #error_code=otp_expired).
  // If that ever lands on the wrong path (root, /login, /auth/callback bounce,
  // or an old email link) we forward it — hash intact — to /auth/confirm, the
  // only page with the manual setSession() hash handler. See DECISIONS.md D-001.
  try{
    var rh=window.location.hash||'';
    if(rh&&window.location.pathname!=='/auth/confirm'&&
       /[#&](type=(recovery|invite|signup)|error_code=|error=)/.test(rh)){
      window.location.replace('/auth/confirm'+rh);
      return;
    }
  }catch(e){}
  try{
    var c=document.cookie.match(/(?:^|;\\s*)THEME=([^;]+)/);
    var v=c?decodeURIComponent(c[1]):null;
    if(v!=='dark'&&v!=='light'&&v!=='system'){
      try{var ls=localStorage.getItem('glev_theme');if(ls==='dark'||ls==='light'||ls==='system')v=ls;}catch(e){}
    }
    if(!v)v='system';
    var resolved=v;
    if(v==='system'){
      resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
    }
    document.documentElement.setAttribute('data-theme',resolved);
    var m=document.querySelector('meta[name="theme-color"]');
    if(m)m.setAttribute('content',resolved==='light'?'#FAFAFB':'#0A0A0F');
  }catch(e){
    document.documentElement.setAttribute('data-theme','dark');
  }
  try{
    function measureSafeArea(){
      var s=document.createElement('div');
      s.style.cssText='position:fixed;bottom:0;left:0;width:0;'+
        'height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden';
      document.documentElement.appendChild(s);
      var h=s.offsetHeight;
      document.documentElement.removeChild(s);
      if(h>0)document.documentElement.style.setProperty('--safe-bottom',h+'px');
    }
    measureSafeArea();
    window.addEventListener('resize',measureSafeArea,{passive:true});
  }catch(e){}
})();
`;

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

  // Theme is honoured on all routes (Task #134 — Light Mode is wired up
  // across all public pages). SSR default is dark unless the cookie says
  // "light"; "system" is resolved client-side in the bootstrap script
  // because matchMedia is unavailable on the server.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("THEME")?.value;
  const initialTheme: "dark" | "light" = themeCookie === "light" ? "light" : "dark";

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      data-theme={initialTheme}
      // The pre-hydration script may switch data-theme between SSR and
      // hydration when the cookie is "system" or absent and the OS
      // prefers light — this attribute change is intentional, so silence
      // React's hydration warning for it.
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning on <head>: Replit's devtools proxy
          injects its own <script> tag into the HTML before React hydrates,
          which causes a structural mismatch React would otherwise throw on.
          suppressHydrationWarning here tells React to skip child-level
          reconciliation inside <head> — safe because all critical scripts
          run synchronously at parse time, before React touches the DOM.
          This has zero effect in production (Vercel doesn't inject anything). */}
      <head suppressHydrationWarning>
        {/* Pre-hydration theme bootstrap. Runs synchronously before React
            mounts so the very first painted frame already has the right
            data-theme attribute and theme-color meta — no FOUC. */}
        {/* Single merged bootstrap script (theme + safe-area).
            suppressHydrationWarning: Replit's devtools proxy replaces this
            tag in dev; the prop tells React to skip the mismatch check.
            No effect in production — Vercel doesn't intercept anything. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SCRIPT }} />
        {/* 2026-05-17 round 6 (lever B — handshake pre-warm): every page
            in the protected zone hits the Supabase REST + Realtime
            endpoint on first paint. preconnect lets the browser pay the
            DNS + TLS handshake during the initial HTML stream so the
            first `fetchMeals` / `fetchCgmSamples` request doesn't
            additionally wait for the TCP+TLS roundtrip. Particularly
            visible on iOS WKWebView where the per-launch connection
            pool starts empty. We read the URL at build time so the
            preconnect resolves to the actual project subdomain (e.g.
            `https://xxx.supabase.co`) rather than the generic root.
            `crossOrigin` matches the fetch credentials mode used by
            supabase-js (`omit`/`include` are both fine for preconnect
            — anonymous covers both). */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
          <>
            <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
          </>
        ) : null}
      </head>
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
        {/* Google Analytics — loads after hydration, never blocks paint.
            ID comes from NEXT_PUBLIC_GA_MEASUREMENT_ID (set in Vercel env vars).
            Route-change page_view events are fired by <GoogleAnalytics> below. */}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
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
                  gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}', { send_page_view: false });
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
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <PreventZoom />
            <PushNotificationsProvider />
            <MealCheckReminderProvider />
            <LandscapeGlucoseOverlay />
            {children}
            <Analytics />
            <CookieBanner />
            <ServiceWorkerRegistration />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
