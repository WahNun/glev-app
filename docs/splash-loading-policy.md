# Splash Screen — Manuelle Installationsanleitung

`@capacitor/splash-screen` ist NICHT in `package.json`. Wegen der Protected-Files-Regel (package.json nur mit expliziter Freigabe) muss Lucas folgendes manuell ausführen.

## Was fehlt

Das Capacitor Splash Screen Plugin ist nicht installiert. Ohne es zeigt die App beim Start den iOS-Default-LaunchScreen (weißes Rechteck oder das zuletzt gerenderte UI), gefolgt von einer harten Webview-Ladelücke.

## Installationsschritte

### 1. Plugin installieren

```bash
npm install @capacitor/splash-screen
npx cap sync ios
```

### 2. Plugin in capacitor.config.ts registrieren

In `capacitor.config.ts` das Plugin zur `packageClassList` hinzufügen:

```ts
packageClassList: [
  // … bestehende Einträge …
  "SplashScreenPlugin",   // ← NEU
],
plugins: {
  // … bestehende Plugin-Configs …
  SplashScreen: {
    launchShowDuration: 1500,      // ms bis Auto-Hide
    launchAutoHide: false,         // wir steuern Hide manuell (s. Schritt 4)
    launchFadeInDuration: 0,
    launchFadeOutDuration: 300,
    backgroundColor: "#09090B",    // matches ios.backgroundColor in capacitor.config.ts
    iosSpinnerStyle: "small",
    showSpinner: false,
  },
},
```

> **ACHTUNG**: Nach jedem `npx cap sync ios` wird die `packageClassList` in
> `ios/App/App/capacitor.config.json` überschrieben (D-032 in DECISIONS.md).
> `SplashScreenPlugin` dort manuell wieder ergänzen.

### 3. Launch-Image-Asset bereitstellen

In Xcode:
- `ios/App/App/Assets.xcassets` → **LaunchImage** Bildset erstellen
- Oder `LaunchScreen.storyboard` anpassen: Glev-Icon (aus Assets.xcassets) zentriert auf `#09090B` Hintergrund

Minimale Variante (nur das Icon, kein Text):
- 1242×2688 px PNG für iPhone Xs Max / 11 Pro Max
- 1125×2436 px PNG für iPhone X / XS / 11 Pro

> Das Glev-Icon liegt in `public/icon.svg` — für den LaunchScreen als PNG exportieren (1024×1024 px reicht, iOS skaliert).

### 4. Splash manuell verstecken

In dem Provider der auf die erste Datenlast wartet (z.B. `SWRProvider` oder ein neues `AppInitProvider`) das Hide nach dem ersten Render aufrufen:

```ts
import { SplashScreen } from "@capacitor/splash-screen";
import { Capacitor } from "@capacitor/core";

// Nach erstem Daten-Fetch oder nach 1.5 s Minimum
async function hideSplash() {
  if (!Capacitor.isNativePlatform()) return;
  await SplashScreen.hide({ fadeOutDuration: 300 });
}
```

Empfohlene Stelle: in `components/SWRProvider.tsx` nach dem ersten SWR-Cache-Hit, oder in `app/(protected)/layout.tsx` als Client-Wrapper.

## Warum launchAutoHide: false?

Mit `launchAutoHide: true` und `launchShowDuration: 1500` verschwindet der Splash immer nach 1,5 s — egal ob die Seite fertig ist. Mit `false` + manuellem `SplashScreen.hide()` verschwindet er erst, wenn die App wirklich bereit ist (aber maximal nach dem eingebauten Safety-Timeout von 2–3 s).

## Nach der Installation

```bash
npx cap sync ios
# Neuer nativer Build nötig — TestFlight / lokales Device
```

Die Web-seitige Ladelücke zwischen Splash und erstem Paint wird durch `GlevLoadingPattern` (neu in `components/GlevLoadingPattern.tsx`) abgedeckt — das zeigt das Glev-Icon mit Shimmer-Skeleton bis die Dashboard-Daten geladen sind.
