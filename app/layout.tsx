import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import "./globals.css";
import { PreventZoom } from "@/components/PreventZoom";
import { ThemeProvider } from "@/components/ThemeProvider";

const META_PIXEL_ID = "984291337254954";

// Inline script that runs BEFORE React hydrates. Reads the THEME cookie
// (and falls back to localStorage / OS preference) to set
// `<html data-theme="...">` so the first painted frame already has the
// correct CSS variables — no flash of dark theme on a light-mode reload.
// Kept tiny and dependency-free so it can ship in <head>; mirrors
// resolveTheme() in lib/theme.ts. If the rules diverge, sync them.
const NO_FLICKER_THEME_SCRIPT = `
(function(){try{
  // ?theme=light|dark URL override — used by canvas mockups / shareable
  // previews to force a theme without touching the user's persisted
  // choice. Does NOT write cookie/localStorage so it has no side effect
  // on the parent session (same-origin canvas iframes share storage).
  try{
    var qp=new URL(location.href).searchParams.get('theme');
    if(qp==='dark'||qp==='light'){
      document.documentElement.setAttribute('data-theme',qp);
      var mq=document.querySelector('meta[name="theme-color"]');
      if(mq)mq.setAttribute('content',qp==='light'?'#FAFAFB':'#0A0A0F');
      return;
    }
  }catch(e){}
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

  // Theme: read the THEME cookie server-side so the SSR HTML already
  // carries the right `data-theme` attribute. The pre-hydration inline
  // script then handles the `system` choice (which depends on
  // matchMedia, only available client-side) and the no-cookie case.
  // Falling back to `dark` here matches the historical look so existing
  // users see no change on first paint after the upgrade.
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
