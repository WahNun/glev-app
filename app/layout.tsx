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
import RevenueCatProvider from "@/components/RevenueCatProvider";
import MealCheckReminderProvider from "@/components/MealCheckReminderProvider";
import LandscapeGlucoseOverlay from "@/components/LandscapeGlucoseOverlay";
import { ThemeProvider } from "@/components/ThemeProvider";
import CookieBanner from "@/components/CookieBanner";
import WebOnlyTracking from "@/components/WebOnlyTracking";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import SplashScreenHider from "@/components/SplashScreenHider";


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

// Site-wide structured data (WebSite + SoftwareApplication + Organization).
// SoftwareApplication uses applicationCategory "HealthApplication" (the schema
// type health apps use) WITHOUT MedicalDevice/MedicalApplication, and repeats
// the "Kein Medizinprodukt" disclaimer in the description — deliberate, to keep
// Glev's documentation-tool positioning intact.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://glev.app/#website",
      url: "https://glev.app",
      name: "Glev",
      description:
        "Dokumentations-App für Typ-1-Diabetes: Mahlzeiten per Sprache, CGM-Daten, Muster im Verlauf",
      inLanguage: "de-DE",
      potentialAction: {
        "@type": "SearchAction",
        target: "https://glev.app/?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://glev.app/#app",
      name: "Glev",
      applicationCategory: "HealthApplication",
      operatingSystem: "iOS, Android, Web",
      description:
        "Dokumentations-Werkzeug für Typ-1-Diabetes. Mahlzeiten per Sprache loggen, CGM-Daten zusammenführen, Muster erkennen. Kein Medizinprodukt.",
      inLanguage: "de-DE",
    },
    {
      "@type": "Organization",
      "@id": "https://glev.app/#organization",
      name: "Glev",
      url: "https://glev.app",
      logo: "https://glev.app/icon.svg",
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://glev.app"),
  title: {
    default: "Glev – Diabetes-Tagebuch per Sprache | Typ-1",
    template: "%s | Glev",
  },
  description:
    "Glev ist die Dokumentations-App für Typ-1-Diabetiker. Mahlzeiten per Sprache loggen, CGM-Daten zusammenführen, Muster im Verlauf erkennen. Kein Medizinprodukt.",
  alternates: {
    canonical: "https://glev.app",
  },
  openGraph: {
    title: "Glev – Diabetes-Tagebuch per Sprache",
    description:
      "Mahlzeiten loggen · CGM-Daten · Muster erkennen. Glev ist ein Dokumentations-Werkzeug, kein Medizinprodukt.",
    url: "https://glev.app",
    siteName: "Glev",
    locale: "de_DE",
    type: "website",
    images: [
      {
        url: "https://glev.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "Glev — Diabetes-Tagebuch per Sprache",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@glevapp",
    title: "Glev – Diabetes-Tagebuch per Sprache",
    description:
      "Mahlzeiten loggen · CGM-Daten · Muster erkennen. Kein Medizinprodukt.",
    images: ["https://glev.app/og-image.png"],
  },
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

  // Normalise the i18n locale ("de" | "en") to a BCP-47 lang attribute.
  // German is the primary/default market (and the canonical), so anything
  // that isn't explicitly English resolves to de-DE — bots without a cookie
  // therefore see de-DE rather than a bare "en".
  const htmlLang = locale === "en" ? "en-US" : "de-DE";

  // Theme is honoured on all routes (Task #134 — Light Mode is wired up
  // across all public pages). SSR default is dark unless the cookie says
  // "light"; "system" is resolved client-side in the bootstrap script
  // because matchMedia is unavailable on the server.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("THEME")?.value;
  const initialTheme: "dark" | "light" = themeCookie === "light" ? "light" : "dark";

  return (
    <html
      lang={htmlLang}
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
        {/* Site-wide JSON-LD (WebSite / SoftwareApplication / Organization).
            Compliance-safe wording — see STRUCTURED_DATA above. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </head>
      <body>
        <WebOnlyTracking gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <PreventZoom />
            <PushNotificationsProvider />
            <RevenueCatProvider />
            <MealCheckReminderProvider />
            <LandscapeGlucoseOverlay />
            {children}
            <Analytics />
            <CookieBanner />
            <ServiceWorkerRegistration />
            <SplashScreenHider />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
