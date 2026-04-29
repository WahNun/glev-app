# Replit Prompt — Meta Pixel Integration

## Task
Integrate the Meta Pixel (ID: 984291337254954) into the Next.js app so it fires on all pages, with specific conversion events on /beta and /pro.

---

## Step 1 — Add Pixel to root layout

Open `app/layout.tsx` and add the following inside the `<head>` section using Next.js `Script` component:

```tsx
import Script from 'next/script'
```

Then inside the `<html>` → `<head>` block, add:

```tsx
<Script id="meta-pixel" strategy="afterInteractive">{`
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
`}</Script>
<noscript>
  <img height="1" width="1" style={{display:'none'}}
    src="https://www.facebook.com/tr?id=984291337254954&ev=PageView&noscript=1"
  />
</noscript>
```

---

## Step 2 — Track Lead event on /beta form submit

In the beta landing page (`app/beta/page.tsx` or wherever the waitlist form submit handler is), add this when the form is successfully submitted:

```tsx
// After successful form submit:
if (typeof window !== 'undefined' && (window as any).fbq) {
  (window as any).fbq('track', 'Lead')
}
```

---

## Step 3 — Track Pro page view

In `app/pro/page.tsx`, add this inside a `useEffect` at the top of the component:

```tsx
useEffect(() => {
  if (typeof window !== 'undefined' && (window as any).fbq) {
    (window as any).fbq('trackCustom', 'ViewProPage')
  }
}, [])
```

---

## Summary of what this does
- `PageView` fires on every page load (both /beta and /pro) → used for retargeting
- `Lead` fires when someone submits the beta waitlist form → main conversion event
- `ViewProPage` fires when someone lands on /pro → separate audience for pro-page visitors

## Do NOT change anything else. Only add the pixel code as described above.
