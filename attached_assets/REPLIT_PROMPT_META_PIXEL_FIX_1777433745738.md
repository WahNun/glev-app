# Replit Prompt — Meta Pixel Fix (window.fbq = undefined)

## Problem
The Meta Pixel script is in the code but `window.fbq` returns `undefined` on glev.app/beta. Pixel is not loading.

## Debug steps first
1. Check `app/layout.tsx` — confirm the `<Script id="meta-pixel" strategy="afterInteractive">` block is actually there
2. Check if any Content Security Policy (CSP) headers in `next.config.js` or `middleware.ts` might be blocking external scripts from `connect.facebook.net`

## Fix Option A — If Script component is missing or wrong
Replace whatever pixel code exists in `app/layout.tsx` with this exact implementation:

```tsx
import Script from 'next/script'

// Inside the RootLayout function, in the return, directly inside <html> (not inside <head>):
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
      fbq('init', '984291337254954');
      fbq('track', 'PageView');
    `,
  }}
/>
```

Note: use `dangerouslySetInnerHTML` instead of JSX children — this is more reliable for inline scripts in Next.js App Router.

## Fix Option B — If CSP is blocking connect.facebook.net
In `next.config.js`, check for a `headers()` function with `Content-Security-Policy`. Add `connect.facebook.net` and `www.facebook.com` to the `script-src` and `connect-src` directives.

## After the fix
Run `npm run build` locally or redeploy to Vercel, then open glev.app/beta and type `window.fbq` in the console — should return a function, not undefined.

## Do NOT change anything else.
