# Insights Overview — Polish Sprint Spec

Ziel: Die `/insights`-Übersichtsseite von „Settings-mäßig" auf die unten beschriebene
Cluster-Card-Liste umbauen. **Kein Footer-Nav nötig** (kommt vom App-Layout).

Screenshot-Referenz: `outputs/insights-mockup.png`

---

## 1. Seiten-Kontext

- Datei: `app/(protected)/insights/page.tsx` (bestehende Datei)
- Die Seite ist `"use client"`, Next.js 15 App Router
- Locale: `useTranslations()` + `useLocale()` via `next-intl`
- Font: **Inter** — kommt via `var(--font-sans)` aus `app/layout.tsx` (bereits global gesetzt, kein eigenes Laden nötig)

---

## 2. Design-Token (aus `app/globals.css`)

```
--bg:            #09090B          /* Page-Background */
--surface:       #111117          /* Card-Background (Basis) */
--border:        rgba(255,255,255,0.08)
--text:          #FFFFFF          /* Primary */
--text-muted:    rgba(255,255,255,0.6)
--text-dim:      rgba(255,255,255,0.45)
```

Brand-Akzent-Farben (Hardcode, nicht in CSS-Vars):
```
ACCENT  = #4F6EF7   /* Blau   — Glukose-Basics */
GREEN   = #22D3A0   /* Grün   — Mahlzeiten & Bolus */
ORANGE  = #FF9500   /* Orange — Adaptive Engine */
PLUS    = #7F77DD   /* Lila   — Workout / GLEV+ */
PINK    = #FF2D78   /* Pink   — Zyklus & Symptome */
```

---

## 3. Page-Header

```
Titel:      "Insights"         → font-size: 28px, font-weight: 700, color: var(--text)
Untertitel: "Karte tippen zum Eintauchen"
                               → font-size: 13px, color: var(--text-dim)
Abstand:    padding: 0 16px 20px
```

---

## 4. Cluster-Liste

5 Cluster in dieser Reihenfolge (von oben nach unten):

```ts
const clusters = [
  {
    id: "glucose-basics",
    title: "Glukose-Basics",
    cardCountLabel: "6 Karten",
    tint: "#4F6EF7",
    icon: "droplet",
    kpi: "98%",
    kpiLabel: "TIR diese Woche",
    locked: false,
  },
  {
    id: "meals-bolus",
    title: "Mahlzeiten & Bolus",
    cardCountLabel: "4 Karten",
    tint: "#22D3A0",
    icon: "utensils",
    kpi: "4,5 IE",
    kpiLabel: "Ø Bolus",
    locked: false,
  },
  {
    id: "adaptive-engine",
    title: "Adaptive Engine & Insulin",
    cardCountLabel: "3 Karten",
    tint: "#FF9500",
    icon: "brain-circuit",
    kpi: "1:12",
    kpiLabel: "Adaptive ICR",
    locked: false,
  },
  {
    id: "workout-activity",
    title: "Workout & Aktivität",
    cardCountLabel: "7 Karten",
    tint: "#7F77DD",
    icon: "activity",
    kpi: "8.241",
    kpiLabel: "Ø Schritte/Tag",
    locked: true,   // GLEV+ Paywall
  },
  {
    id: "cycle-symptoms",
    title: "Zyklus & Symptome",
    cardCountLabel: "1 Karte",
    tint: "#FF2D78",
    icon: "moon",
    kpi: "Phase 2",
    kpiLabel: "aktuell",
    locked: false,
  },
];
```

Liste-Container:
```
display: flex
flex-direction: column
gap: 12px
padding: 0 16px
```

---

## 5. ClusterCard — Maße & Aufbau

```
position: relative
background: linear-gradient(135deg, {tint}1a 0%, transparent 50%), var(--surface)
border-radius: 16px
padding: 20px
min-height: 100px
display: flex
align-items: center
gap: 16px
overflow: hidden
```

### 5a. Accent-Stripe (ganz links)
```
position: absolute
left: 0, top: 0, bottom: 0
width: 4px
background: {tint}
border-radius: 16px 0 0 16px
```

### 5b. Icon-Box
```
width: 44px, height: 44px
background: {tint}26      ← 15% Opacity-Hex
border-radius: 12px
display: flex, align-items: center, justify-content: center
flex-shrink: 0
margin-left: 8px          ← wegen der 4px Stripe
```

Icon selbst: Lucide-SVG, 22×22px, color: {tint}

### 5c. Text-Block (flex: 1)
```
Titel:      font-size: 17px, font-weight: 500, color: var(--text)
            white-space: nowrap, overflow: hidden, text-overflow: ellipsis
Count:      font-size: 13px, color: var(--text-dim), margin-top: 2px
```

Wenn `locked: true` → Lock-Icon (15×15px, opacity: 0.7) inline rechts neben Titel

### 5d. KPI-Block (text-align: right, flex-shrink: 0)
```
KPI-Wert:   font-size: 24px, font-weight: 500, color: var(--text), line-height: 1.1
KPI-Label:  font-size: 12px, color: var(--text-dim), margin-top: 2px, white-space: nowrap
```

### 5e. Chevron (flex-shrink: 0)
```
Lucide ChevronRight, 18×18px, color: var(--text-ghost)  →  rgba(255,255,255,0.18)
```

---

## 6. GLEV+ Lock-Overlay (nur wenn `locked: true`)

Zwei Schichten über der Card:

**Schicht 1 — Dim:**
```
position: absolute, inset: 0
background: rgba(0,0,0,0.38)
border-radius: 16px
pointer-events: none
```

**Schicht 2 — Badge:**
```
position: absolute, top: 12px, right: 12px
background: #7F77DD
color: #fff
font-size: 11px, font-weight: 700, letter-spacing: 0.07em
padding: 3px 10px, border-radius: 20px
z-index: 2
Text: "GLEV+"
```

Card-Container-Opacity bei locked: `opacity: 0.72`

---

## 7. Lucide-Icon-SVG-Paths (viewBox="0 0 24 24", stroke-width="2", fill="none", stroke-linecap="round", stroke-linejoin="round")

**droplet:**
```svg
<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
```

**utensils:**
```svg
<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
<line x1="7" y1="2" x2="7" y2="22"/>
<path d="M21 15V2a5 5 0 0 0-5 5v6h3.5l-1.5 9"/>
```

**brain-circuit:**
```svg
<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
<line x1="12" y1="13" x2="12" y2="22"/>
<path d="M8 13h8"/>
```

**activity:**
```svg
<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
```

**moon:**
```svg
<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
```

**lock** (für locked-Inline-Icon):
```svg
<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
```

**chevron-right:**
```svg
<polyline points="9 18 15 12 9 6"/>
```

> **Empfehlung:** `lucide-react` ist bereits im Projekt installiert.
> Alle Icons gibt es als `import { Droplet, Utensils, BrainCircuit, Activity, Moon, Lock, ChevronRight } from "lucide-react"` — kein Inline-SVG nötig.

---

## 8. Interaktion

Jede Card ist klickbar → navigiert zur jeweiligen Cluster-Detailseite.
Locked-Cards: Klick → öffnet GLEV+-Upgrade-Gate (bestehende `<UpgradeGate>`-Komponente im Projekt).

```tsx
import UpgradeGate from "@/components/UpgradeGate";
import { usePlan } from "@/hooks/usePlan";
```

---

## 9. Alphawerte als Hex-Suffix (Referenz)

| Opacity | Hex |
|---------|-----|
| 10%     | `1a` |
| 15%     | `26` |
| 38%     | `61` |

Verwendung: `{tint}1a` = Gradient-Tint, `{tint}26` = Icon-Box-Background

---

## 10. Was NICHT geändert wird

- Die bestehenden Cluster-Detailseiten (Swipe-Pager) bleiben unangetastet
- `types/InsightsCluster.ts` bleibt unverändert
- Die KPI-Werte im Mockup sind Platzhalter — im echten Code kommen sie aus den
  bestehenden Berechnungsfunktionen der Seite (z.B. `computeAdaptiveICR`, TIR aus CGM-Daten)
