import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { PreventZoom } from "@/components/PreventZoom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { APP_ROUTE_REGEX_SOURCE, isAppRoute, PATHNAME_HEADER } from "@/lib/appRoutes";

const META_PIXEL_ID = "984291337254954";

// Inline script that runs BEFORE React hydrates. On in-app routes it
// reads the THEME cookie (with localStorage / OS-preference fallback)
// and sets `<html data-theme="...">` so the first painted frame already
// has the correct CSS variables — no flash of dark theme on a
// light-mode reload. On marketing / public routes it ALWAYS forces
// dark, regardless of the persisted preference, because those pages
// hardcode dark hex values and would render white-on-white otherwise.
// The set of in-app paths comes from `lib/appRoutes.ts`; the regex
// source is interpolated below so the two stay in sync. Kept tiny and
// dependency-free so it can ship inline in <head>.
const NO_FLICKER_THEME_SCRIPT = `
(function(){try{
  var APP_RE=${JSON.stringify(APP_ROUTE_REGEX_SOURCE)};
  var isApp=new RegExp(APP_RE).test(location.pathname);
  var resolved='dark';
  if(isApp){
    var c=document.cookie.match(/(?:^|;\\s*)THEME=([^;]+)/);
    var v=c?decodeURIComponent(c[1]):null;
    if(v!=='dark'&&v!=='light'&&v!=='system'){
      try{var ls=localStorage.getItem('glev_theme');if(ls==='dark'||ls==='light'||ls==='system')v=ls;}catch(e){}
    }
    if(!v)v='system';
    resolved=v;
    if(v==='system'){
      resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
    }
  }
  document.documentElement.setAttribute('data-theme',resolved);
  var m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',resolved==='light'?'#FAFAFB':'#0A0A0F');
}catch(e){
  document.documentElement.setAttribute('data-theme','dark');
}})();
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

  // Theme: marketing / public routes are always dark (their components
  // hardcode dark hex values, so flipping them to light produces
  // white-on-white text). Only in-app routes honour the THEME cookie
  // for SSR. The pre-hydration inline script applies the same rule on
  // the client, then takes care of the `system` choice (matchMedia is
  // only available client-side). The pathname is forwarded by
  // middleware via PATHNAME_HEADER so this server component can branch
  // on it without reading the URL directly.
  const headerStore = await headers();
  const reqPath = headerStore.get(PATHNAME_HEADER) ?? "";
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("THEME")?.value;
  const initialTheme: "dark" | "light" =
    isAppRoute(reqPath) && themeCookie === "light" ? "light" : "dark";

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
      <head>
        {/* Pre-hydration theme bootstrap. Runs synchronously before React
            mounts so the very first painted frame already has the right
            data-theme attribute and theme-color meta — no FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLICKER_THEME_SCRIPT }} />
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
          <ThemeProvider>
            <PreventZoom />
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
