# REPLIT PROMPT — Post-Meal Prompt: Floating Banner → Badge auf Mahlzeit-Karte

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## ZIEL

Der aktuelle floating Bottom-Sheet-Prompt ("BG nach 90 Minuten") ist störend und nervt Nutzer. Er soll durch ein dezentes Badge auf der Mahlzeit-Karte im Verlauf ersetzt werden.

**Vorher:** Floating Banner poppt automatisch auf, überlagert den Content
**Nachher:** Kleines Badge-Icon auf der Mahlzeit-Karte ("● Wert offen") — Nutzer klickt selbst drauf wenn er möchte

---

## STEP 1 — Floating Banner deaktivieren

Suche `PostMealPrompt` in der Layout-Komponente und entferne die Einbindung:

```bash
grep -r "PostMealPrompt" app/ components/ --include="*.tsx" -l
```

In der gefundenen Datei (wahrscheinlich `components/Layout.tsx` oder `app/(protected)/layout.tsx`):

```tsx
// ENTFERNEN oder auskommentieren:
// import { PostMealPrompt } from '@/components/PostMealPrompt';
// <PostMealPrompt />
```

Die Komponente selbst (`components/PostMealPrompt.tsx`) und den Hook (`hooks/usePostMealCheck.ts`) **stehen lassen** — werden später für Badge-Logik wiederverwendet.

---

## STEP 2 — Badge-Logik in Mahlzeit-Karte einbauen

Finde die Komponente die einzelne Mahlzeit-Einträge im Verlauf rendert:

```bash
grep -r "meal_time\|glucose_2h\|BG AFTER\|Verlauf" app/ components/ --include="*.tsx" -l
```

In der Mahlzeit-Karten-Komponente:

**Füge eine Badge-Anzeige hinzu** — sichtbar wenn:
1. Die Mahlzeit 25–210 Minuten her ist (noch im Messfenster)
2. Mindestens ein glucose_*-Feld (glucose_30min, glucose_1h, glucose_90min, glucose_2h, glucose_3h) noch NULL ist

```tsx
// Badge-Logik (in der Karten-Komponente):
const now = Date.now();
const mealTime = new Date(meal.meal_time).getTime();
const minutesSince = (now - mealTime) / 60000;

const hasPendingGlucose =
  minutesSince >= 25 &&
  minutesSince <= 210 &&
  (meal.glucose_30min === null ||
   meal.glucose_1h === null ||
   meal.glucose_90min === null ||
   meal.glucose_2h === null ||
   meal.glucose_3h === null);
```

**Badge-Element** (oben rechts auf der Karte, oder neben dem Mahlzeit-Namen):

```tsx
{hasPendingGlucose && (
  <button
    onClick={() => setShowGlucoseInput(true)}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 20,
      border: '1px solid rgba(79,110,247,0.4)',
      background: 'rgba(79,110,247,0.1)',
      color: '#4F6EF7',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
    }}
  >
    <span style={{ fontSize: 8, color: '#4F6EF7' }}>●</span>
    BG eintragen
  </button>
)}
```

---

## STEP 3 — Inline Eingabe-Modal bei Klick auf Badge

Wenn Nutzer auf "BG eintragen" klickt, öffnet sich ein **Inline-Sheet direkt unter der Mahlzeit-Karte** (kein globaler Overlay):

```tsx
const [showGlucoseInput, setShowGlucoseInput] = useState(false);
const [glucoseValue, setGlucoseValue] = useState('');
const [saving, setSaving] = useState(false);

// Welcher Zeitpunkt ist aktuell offen?
const TIMEPOINTS = [
  { key: '30min', column: 'glucose_30min', label: '30 Min',  min: 25,  max: 50  },
  { key: '1h',    column: 'glucose_1h',    label: '1 Std',   min: 55,  max: 80  },
  { key: '90min', column: 'glucose_90min', label: '90 Min',  min: 85,  max: 110 },
  { key: '2h',    column: 'glucose_2h',    label: '2 Std',   min: 115, max: 150 },
  { key: '3h',    column: 'glucose_3h',    label: '3 Std',   min: 175, max: 210 },
];

const activeTimepoint = TIMEPOINTS.find(tp =>
  minutesSince >= tp.min &&
  minutesSince <= tp.max &&
  meal[tp.column] === null
) || TIMEPOINTS.find(tp => meal[tp.column] === null);

const handleSave = async () => {
  if (!activeTimepoint) return;
  const value = parseInt(glucoseValue);
  if (!value || value < 20 || value > 600) return;
  setSaving(true);
  const res = await fetch(`/api/meals/${meal.id}/glucose`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timepoint: activeTimepoint.key, value }),
  });
  if (res.ok) {
    setShowGlucoseInput(false);
    setGlucoseValue('');
    // Optional: refetch meal data
  }
  setSaving(false);
};

// JSX für Inline-Eingabe:
{showGlucoseInput && activeTimepoint && (
  <div style={{
    marginTop: 8,
    padding: '12px',
    background: '#1a1a28',
    borderRadius: 12,
    border: '1px solid rgba(79,110,247,0.2)',
  }}>
    <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
      BG nach {activeTimepoint.label} — {meal.name}
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          type="number"
          placeholder="z.B. 130"
          min={20} max={600}
          value={glucoseValue}
          onChange={(e) => setGlucoseValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
          style={{
            width: '100%',
            background: '#111117',
            border: '1px solid #2a2a35',
            borderRadius: 8,
            padding: '10px 42px 10px 12px',
            color: '#fff',
            fontSize: 15,
            boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontSize: 12, pointerEvents: 'none' }}>mg/dL</span>
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !glucoseValue}
        style={{
          background: saving || !glucoseValue ? '#333' : '#4F6EF7',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          padding: '10px 16px',
          fontWeight: 600,
          fontSize: 13,
          cursor: saving || !glucoseValue ? 'default' : 'pointer',
        }}
      >
        {saving ? '…' : 'Speichern'}
      </button>
      <button
        onClick={() => setShowGlucoseInput(false)}
        style={{ background: 'none', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
      >×</button>
    </div>
  </div>
)}
```

---

## NICHT ÄNDERN

- `components/PostMealPrompt.tsx` und `hooks/usePostMealCheck.ts` — stehen lassen
- API Route `/api/meals/[id]/glucose` — nicht anfassen
- Verlauf-Layout, Styling, andere Karten
- Andere Seiten

---

## VERIFY

1. `tsc --noEmit` → kein Fehler
2. Verlauf öffnen → kein floating Banner mehr
3. Mahlzeit die 25–210 min alt ist → Badge "● BG eintragen" sichtbar
4. Badge klicken → Inline-Eingabe erscheint direkt unter der Karte
5. Wert eingeben + Speichern → Eingabe verschwindet, Badge verschwindet
6. `git add -A && git commit -m "feat: replace floating post-meal prompt with inline badge on meal card" && git push origin main`

=== END ===
