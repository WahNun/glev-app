# Bottom-Nav-Overlap Final — Diagnose 2026-06-21

## Kontext

Nach PR #12 (Buffer 8 → 40 px) besteht der Overlap auf Dashboard und Settings WEITERHIN.
Dritte Beschwerde. Root-Cause-Analyse statt weiteres Raten.

---

## Measurement-Tabelle (iPhone 14 Pro, H = 844 pt, DPR 3, safe-bottom = 34 pt)

| Variable | Berechnung | Wert (pt) |
|---|---|---|
| `--safe-bottom` | `env(safe-area-inset-bottom)` | 34 |
| `--nav-bottom-total` | 62 + 12 + 34 | **108** |
| `padding-bottom` (vor Fix) | 108 + 40 | **148** |
| Nav pill `bottom` | `calc(12px + 34px)` | 46 von Bildschirm-Unterkante |
| Nav pill top | 46 + 62 | **108 von Bildschirm-Unterkante** |
| Nav pill top (viewport Y) | 844 − 108 | **736** |

### Beobachteter Overlap (vor Fix)

Mit `zoom: 1.12` auf `.glev-main` gilt für die Viewport-Y-Position des
letzten Content-Elements bei Max-Scroll:

```
last_content_viewport_y = (H − pb) × z
                        = (844 − 148) × 1.12
                        = 696 × 1.12
                        = 779.5 pt
```

Nav pill top = 736 pt → **Overlap = 779.5 − 736 = 43.5 pt** ← das ist der Bug.

**Dashboard** (kein extra margin-bottom unter letztem Entry):
> `last_content_y = 779.5 pt` → Overlap 43.5 pt

**Settings** (Abmelden-Button hat `marginBottom: 32` in Zoom-Koordinaten = 35.8 pt gerendert):
> `last_content_y = (844 − 148 − 32) × 1.12 = 664 × 1.12 = 743.7 pt` → Overlap 7.7 pt

Das erklärt, warum Settings "fast ok" wirkt (geringer Overlap) und Dashboard deutlich schlimmer ist.

---

## Root Cause: `zoom: 1.12` auf dem Scroll-Container

**Die kritische Zeile:** `components/Layout.tsx:1141`
```jsx
style={{ flex: 1, ..., zoom: 1.12 }}
```

`.glev-main` ist GLEICHZEITIG:
1. Scroll-Container (`overflow-y: auto; height: 100dvh`)
2. Zoom-Host (`zoom: 1.12`)

### Warum das die Scroll-Geometrie bricht

Wenn `zoom: z` auf einem Scroll-Container liegt, ist der sichtbare CSS-Bereich
pro Scroll-Position nur `clientHeight / z` Pixel breit (nicht `clientHeight`).
Diese `clientHeight / z = 844 / 1.12 = 753.6 pt` werden dann auf volle `844 pt`
Viewport gerendert.

```
clientHeight (CSS) = H = 844 pt          ← was JS .clientHeight zurückgibt
Sichtbarer CSS-Bereich = H / z = 753.6 pt
scrollTop_max = scrollHeight − H          ← scrollt zu weit nach unten!

Position des letzten Items bei Max-Scroll (viewport Y):
  = (H − pb) × z                         ← NICHT (H − pb)
```

Der Nav-Pill ist `position: fixed` und kennt kein Zoom. Er liegt immer bei
viewport Y = 736 pt. Das `padding-bottom: 148 pt (CSS)` rendert als
`148 × 1.12 = 165.8 pt` — aber der Scroll-Container "sieht" vom unteren
Ende nur `H / z = 753.6 pt` CSS, also landet das letzte Item bei 779.5 pt.

### Warum PR #12 (+32 pt Buffer) nicht half

| Buffer | pb | last_content_y | nav_top | Overlap |
|---|---|---|---|---|
| 8 pt | 116 | (844-116)×1.12 = 815.4 | 736 | **79.4 pt** |
| 40 pt | 148 | (844-148)×1.12 = 779.5 | 736 | **43.5 pt** |
| 120 pt (Fix) | 228 | (844-228)×1.12 = 689.9 | 736 | **−46.1 pt** = 46 pt Clearance ✓ |

Der 32-pt-Sprung hat den Overlap reduziert, aber NICHT eliminiert — deshalb
wirkte es für Lucas "unverändert" (immer noch sichtbar teilverdeckt).

---

## Fix-Pfad

### Minimaler Buffer für ≥ 16 pt Clearance

Bedingung: `(H − pb) × z ≤ (H − N) − 16`

Aufgelöst nach Buffer (= pb − N):
```
Buffer ≥ H × (1 − 1/z) + 16/z
       = H × 0.1071 + 14.3
```

| Gerät | H (pt) | N (pt) | Min. Buffer |
|---|---|---|---|
| iPhone SE (3rd gen) | 667 | 74 | 85.7 pt |
| iPhone 14 Pro | 844 | 108 | 104.7 pt |
| iPhone 15 Pro Max | 932 | 108 | 114.1 pt |

**Gewählter Fix: Buffer = 120 pt** — deckt alle aktuellen iOS-Geräte mit ≥ 24 pt Clearance ab.

### Code-Änderung (eine Zeile)

**`components/Layout.tsx` Zeile 730:**
```diff
-  padding: calc(var(--nav-top-total) + 4px) 16px calc(var(--nav-bottom-total) + 40px) !important;
+  padding: calc(var(--nav-top-total) + 4px) 16px calc(var(--nav-bottom-total) + 120px) !important;
```

### Erwartetes Ergebnis nach Fix

| Gerät | H | pb | last_content_y | nav_top | Clearance |
|---|---|---|---|---|---|
| iPhone SE | 667 | 194 | (667-194)×1.12 = 529.8 | 593 | **63.2 pt** ✓ |
| iPhone 14 Pro | 844 | 228 | (844-228)×1.12 = 689.9 | 736 | **46.1 pt** ✓ |
| iPhone 15 Pro Max | 932 | 228 | (932-228)×1.12 = 788.5 | 824 | **35.5 pt** ✓ |

Alle ≥ 16 pt Clearance → kein sichtbarer Overlap auf keinem aktuellen iOS-Gerät.

---

## Alternativer Fix (langfristig empfohlen)

`zoom: 1.12` vom Scroll-Container (`.glev-main`) auf einen **Inner-Content-Wrapper** verschieben:

```jsx
<main className="glev-main" style={{ ...keinZoom... }}>
  <div style={{ zoom: 1.12 }}>
    <TrialCountdownBanner />
    <GlevAIProvider value={glevAi}>{children}</GlevAIProvider>
  </div>
</main>
```

Dann gilt `z = 1` für die Scroll-Geometrie → `last_content_y = H − pb` = 844 − 148 = 696 pt < nav_top 736 pt → 40 pt Clearance mit aktuellem Buffer 40 pt. Visuell gleich, mathematisch sauber.

**Nicht in diesem Hotfix gemacht:** Änderung am Zoom-Host ändert Content-Box-Breite und könnte
horizontale Layout-Effekte haben. Sicherer für einen eigenen PR.

---

## Entscheidung

Root cause: `zoom: 1.12` auf Scroll-Container lässt `padding-bottom` nicht linear mit Viewport-Clearance skalieren.

Fix: Buffer 40 → 120 pt. Deckt alle aktuellen iOS-Devices mit ≥ 35 pt Clearance ab.

Screenshots: `docs/screenshots/bottom-nav-fix-dashboard-after.png` und `docs/screenshots/bottom-nav-fix-settings-after.png`
