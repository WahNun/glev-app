# Play Store Listing — `app.glev`

This folder contains every text and graphic asset that the Google Play
Console asks for when you publish the Glev Android app to **Internal
Testing** (and later to Production). Nothing here is auto-uploaded —
the Play Console is a manual, copy-paste workflow.

The signed `.aab` itself is produced separately on macOS, see
[`../SIGNING_SETUP.md`](../SIGNING_SETUP.md).

---

## Folder layout

```
android/store-listing/
├── README.md                  ← this file
├── listing-metadata.txt       ← non-text fields (category, tags, contact, etc.)
├── de/
│   ├── title.txt              ← App name (DE), max 30 chars
│   ├── short-description.txt  ← Short description (DE), max 80 chars
│   └── full-description.txt   ← Full description (DE), max 4000 chars
├── en/
│   ├── title.txt              ← App name (EN), max 30 chars
│   ├── short-description.txt  ← Short description (EN), max 80 chars
│   └── full-description.txt   ← Full description (EN), max 4000 chars
├── graphics/
│   ├── app-icon-512.png       ← 512×512 high-res icon
│   └── feature-graphic-1024x500.png   ← 1024×500 feature graphic
└── screenshots/
    ├── 01-dashboard.png       ← Phone screenshot 1
    ├── 02-engine.png          ← Phone screenshot 2
    ├── 03-insights.png        ← Phone screenshot 3
    └── 04-entries.png         ← Phone screenshot 4
```

All texts are kept as plain `.txt` so the Play Console copy-paste flow is
mistake-proof — open the file, ⌘A / ⌘C, paste into the field.

---

## Where each file goes in the Play Console

The screens below are the Play Console paths as of May 2026. Google
occasionally renames sections — if a label moves, the wording in
parentheses is the field's machine name and is more stable.

### 1. App content & policies
*Play Console → Policy → App content*

| Console field          | Source                                   |
|------------------------|------------------------------------------|
| Privacy policy URL     | `listing-metadata.txt` → "Privacy policy URL" |
| Ads                    | `listing-metadata.txt` → "Ads"           |
| Target audience & content | `listing-metadata.txt` → "Target audience and content" |
| Data safety            | `listing-metadata.txt` → "Data safety form" |
| Content rating (IARC)  | Run the questionnaire; expected outcome listed in `listing-metadata.txt` |

### 2. Main store listing
*Play Console → Grow users → Store presence → Main store listing*

Pick the default language (**German — Germany**) first, then switch the
language selector to **English (United States)** and repeat.

| Console field          | DE source                          | EN source                          |
|------------------------|------------------------------------|------------------------------------|
| App name               | `de/title.txt`                     | `en/title.txt`                     |
| Short description      | `de/short-description.txt`         | `en/short-description.txt`         |
| Full description       | `de/full-description.txt`          | `en/full-description.txt`          |
| App icon (512×512)     | `graphics/app-icon-512.png`        | (same — uploaded once)             |
| Feature graphic (1024×500) | `graphics/feature-graphic-1024x500.png` | (same)                  |
| Phone screenshots      | all four PNGs in `screenshots/`    | (same — re-upload per language)    |

> Phone screenshots have to be uploaded **per language** even if the
> images are identical. Play Console does not inherit screenshots from
> the default language for the rest.

### 3. Store settings
*Play Console → Grow users → Store presence → Store settings*

| Console field          | Source                                   |
|------------------------|------------------------------------------|
| App category           | `listing-metadata.txt` → "Category"      |
| Tags                   | `listing-metadata.txt` → "Tags"          |
| Email                  | `listing-metadata.txt` → "Contact details" |
| Website                | `listing-metadata.txt` → "Contact details" |
| External marketing     | Off                                      |

### 4. Internal testing track
*Play Console → Test and release → Testing → Internal testing*

1. Create a release.
2. Upload the signed `.aab` (built per `../SIGNING_SETUP.md`).
3. Add the release notes:
   - **DE:** "Erste Internal-Testing-Version. Lädt die aktuelle Web-App
     glev.app im Capacitor-Shell."
   - **EN:** "First internal-testing build. Loads the current glev.app
     web app inside the Capacitor shell."
4. Add testers (your own Google account at minimum) under
   "Testers" → create or pick a tester list.
5. Save → Review → Start rollout to Internal testing.

---

## Asset specifications (for re-generation)

| Asset                | Size        | Format     | Notes                         |
|----------------------|-------------|------------|-------------------------------|
| App icon             | 512 × 512   | PNG, 32-bit| No alpha at the corners; current file is sourced from `public/icon-512.png`. |
| Feature graphic      | 1024 × 500  | PNG / JPEG | No transparency. Generated from `scripts/build-feature-graphic.mjs`. |
| Phone screenshots    | 320–3840 px on each side | PNG / JPEG (24-bit, no alpha) | Min 2, max 8. Maximum aspect ratio 2:1 (longest side ≤ 2× shortest side). Current files are **1080 × 1920** (clean 9:16) — the source mockups (~520 × 1130, ratio 2.17 = above Play's 2:1 cap) are scaled and centred on a `#0A0A0F` canvas by `scripts/build-store-screenshots.mjs`. |

To regenerate the feature graphic after a brand tweak:

```bash
node scripts/build-feature-graphic.mjs
```

To refresh the screenshots, drop new mockup PNGs into `public/mockups/`
(or update them at the source) and run:

```bash
node scripts/build-store-screenshots.mjs
```

That script reads `public/mockups/{dashboard,engine,insights,entries}.png`,
scales each to fit a 1080 × 1920 (9:16) canvas with a `#0A0A0F`
background, and writes them as `01-…`, `02-…` etc. into this folder so
the upload order in the Play Console stays stable.

Once the first AAB runs on a real device or emulator, replace the
generated images with native screenshots (Pixel 6/7 portrait
recommended) — see follow-up task in the project tracker.

---

## Privacy policy & legal

- **Privacy policy URL:** <https://glev.app/legal/privacy>
- **Imprint / contact:** <https://glev.app/legal/imprint>
- **Terms:** <https://glev.app/legal/terms>

Google requires that the privacy URL is reachable without login and
returns HTTP 200 from the Play Review crawlers. If you ever change the
URL, also update it here in `listing-metadata.txt` and on every active
release.

---

## Checklist before submitting Internal Testing

- [ ] `.aab` built and signed on macOS (`SIGNING_SETUP.md`)
- [ ] Privacy URL reachable in incognito
- [ ] App content policies: Ads = No, IAP = Yes (out-of-app), Data safety filled
- [ ] Main store listing complete in **both** DE and EN
- [ ] Feature graphic and at least 2 phone screenshots uploaded
- [ ] Release notes written in DE and EN
- [ ] At least one tester email added to the internal testing list
