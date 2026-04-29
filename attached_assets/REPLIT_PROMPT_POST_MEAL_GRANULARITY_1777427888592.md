# REPLIT PROMPT — Post-Meal Granularität: Mehrere Messzeitpunkte (0–3h)

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## KONTEXT

Glev erfasst aktuell nach einer Mahlzeit nur den 2h-Glukosewert. Das reicht nicht, um Hypo-Momente innerhalb der ersten Stunde zu erkennen. Die DB-Felder existieren bereits: `glucose_30min`, `glucose_1h`, `glucose_90min`, `glucose_2h`, `glucose_3h` in der `meals`-Tabelle.

Ziel: Nach dem Essen soll Glev den User zu mehreren Zeitpunkten nach seinem Glukosewert fragen — automatisch, via In-App-Banner. So werden Hypomomente zwischen den bisherigen Messpunkten nicht mehr verpasst.

---

## STEP 1 — Datei finden

```bash
find . -name "usePostMealCheck.ts" -o -name "PostMealPrompt.tsx" 2>/dev/null
```

Falls nicht vorhanden:
```bash
find . -name "*.ts" -o -name "*.tsx" | xargs grep -l "glucose_2h\|postmeal\|post_meal" 2>/dev/null
```

---

## STEP 2 — Hook erweitern: `hooks/usePostMealCheck.ts`

Ersetze den bestehenden Hook vollständig durch diese Version, die alle 5 Zeitpunkte prüft:

```ts
'use client';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export type Timepoint = '30min' | '1h' | '90min' | '2h' | '3h';

export type PendingMeal = {
  id: string;
  meal_time: string;
  name: string;
  timepoint: Timepoint;
  label: string; // z.B. "30 Minuten"
};

// Wann wird welcher Zeitpunkt abgefragt (Minuten nach Mahlzeit)
const TIMEPOINT_CONFIG: {
  key: Timepoint;
  column: string;
  label: string;
  minMinutes: number;
  maxMinutes: number;
}[] = [
  { key: '30min', column: 'glucose_30min', label: '30 Minuten',  minMinutes: 25,  maxMinutes: 50  },
  { key: '1h',    column: 'glucose_1h',    label: '1 Stunde',    minMinutes: 55,  maxMinutes: 80  },
  { key: '90min', column: 'glucose_90min', label: '90 Minuten',  minMinutes: 85,  maxMinutes: 110 },
  { key: '2h',    column: 'glucose_2h',    label: '2 Stunden',   minMinutes: 115, maxMinutes: 150 },
  { key: '3h',    column: 'glucose_3h',    label: '3 Stunden',   minMinutes: 175, maxMinutes: 210 },
];

export function usePostMealCheck() {
  const [pendingMeal, setPendingMeal] = useState<PendingMeal | null>(null);
  const supabase = createClientComponentClient();

  const checkForPendingMeals = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Letzte 3.5 Stunden abdecken
    const windowStart = new Date(Date.now() - 210 * 60 * 1000).toISOString();

    const { data: meals } = await supabase
      .from('meals')
      .select('id, meal_time, name, glucose_30min, glucose_1h, glucose_90min, glucose_2h, glucose_3h')
      .eq('user_id', user.id)
      .gte('meal_time', windowStart)
      .order('meal_time', { ascending: false })
      .limit(5);

    if (!meals || meals.length === 0) return;

    const now = Date.now();

    for (const meal of meals) {
      const mealTime = new Date(meal.meal_time).getTime();
      const minutesSince = (now - mealTime) / 60000;

      for (const tp of TIMEPOINT_CONFIG) {
        const columnValue = meal[tp.column as keyof typeof meal];
        if (
          minutesSince >= tp.minMinutes &&
          minutesSince <= tp.maxMinutes &&
          columnValue === null
        ) {
          setPendingMeal({
            id: meal.id,
            meal_time: meal.meal_time,
            name: meal.name,
            timepoint: tp.key,
            label: tp.label,
          });
          return; // Nur ein Prompt gleichzeitig
        }
      }
    }

    setPendingMeal(null);
  };

  useEffect(() => {
    checkForPendingMeals();
    const interval = setInterval(checkForPendingMeals, 60 * 1000); // jede Minute prüfen
    const onFocus = () => checkForPendingMeals();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const dismiss = () => setPendingMeal(null);

  return { pendingMeal, dismiss, refetch: checkForPendingMeals };
}
```

---

## STEP 3 — Komponente anpassen: `components/PostMealPrompt.tsx`

Ändere die Komponente so, dass sie den dynamischen `timepoint` und `label` aus `pendingMeal` nutzt:

```tsx
'use client';
import { useState } from 'react';
import { usePostMealCheck } from '@/hooks/usePostMealCheck';

export function PostMealPrompt() {
  const { pendingMeal, dismiss } = usePostMealCheck();
  const [glucoseValue, setGlucoseValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!pendingMeal || saved) return null;

  const handleSave = async () => {
    const value = parseInt(glucoseValue);
    if (!value || value < 20 || value > 600) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/meals/${pendingMeal.id}/glucose`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timepoint: pendingMeal.timepoint, value }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(dismiss, 1500);
      }
    } finally {
      setSaving(false);
    }
  };

  const mealLabel = pendingMeal.name
    ? pendingMeal.name.length > 24
      ? pendingMeal.name.slice(0, 24) + '…'
      : pendingMeal.name
    : 'deine letzte Mahlzeit';

  return (
    <div style={{ position:'fixed', bottom:72, left:0, right:0, zIndex:100, padding:'0 16px' }}>
      <div style={{ background:'#1a1a22', border:'1px solid #2a2a35', borderRadius:16, padding:'16px', boxShadow:'0 -4px 24px rgba(0,0,0,0.4)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <div style={{ color:'#fff', fontWeight:600, fontSize:14 }}>
              BG nach {pendingMeal.label} — {mealLabel}
            </div>
            <div style={{ color:'#888', fontSize:12, marginTop:2 }}>
              Wie ist dein Blutzucker jetzt?
            </div>
          </div>
          <button onClick={dismiss} style={{ background:'none', border:'none', color:'#888', fontSize:20, cursor:'pointer', padding:'0 0 0 12px', lineHeight:1 }} aria-label="Schließen">×</button>
        </div>

        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div style={{ position:'relative', flex:1 }}>
            <input
              type="number"
              placeholder="z.B. 130"
              min={20} max={600}
              value={glucoseValue}
              onChange={(e) => setGlucoseValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              style={{ width:'100%', background:'#111117', border:'1px solid #2a2a35', borderRadius:10, padding:'12px 48px 12px 14px', color:'#fff', fontSize:16, boxSizing:'border-box' }}
              autoFocus
            />
            <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color:'#888', fontSize:13, pointerEvents:'none' }}>mg/dL</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !glucoseValue}
            style={{ background: saving || !glucoseValue ? '#333' : '#4F6EF7', color:'white', border:'none', borderRadius:10, padding:'12px 20px', fontWeight:600, fontSize:14, cursor: saving || !glucoseValue ? 'default' : 'pointer', whiteSpace:'nowrap', transition:'background 0.15s' }}
          >
            {saving ? '…' : saved ? '✓' : 'Speichern'}
          </button>
        </div>

        <button onClick={dismiss} style={{ background:'none', border:'none', color:'#666', fontSize:12, cursor:'pointer', marginTop:8, padding:0 }}>
          Später eingeben
        </button>
      </div>
    </div>
  );
}
```

---

## STEP 4 — API Route prüfen: `app/api/meals/[id]/glucose/route.ts`

Stelle sicher, dass die PATCH Route alle 5 Timepoints unterstützt:

```ts
type Timepoint = '30min' | '1h' | '90min' | '2h' | '3h';

const COLUMN_MAP: Record<Timepoint, string> = {
  '30min': 'glucose_30min',
  '1h':    'glucose_1h',
  '90min': 'glucose_90min',
  '2h':    'glucose_2h',
  '3h':    'glucose_3h',
};
```

Falls die Datei bereits alle 5 hat → nichts ändern.

---

## NICHT ÄNDERN

- DB-Schema / Supabase Migrations (Felder existieren bereits)
- Layout, Styling, andere Components
- Andere API Routes
- Auth-Logik

---

## VERIFY

1. `tsc --noEmit` → kein Fehler
2. Testmahlzeit loggen → nach ~25 Minuten erscheint der 30min-Prompt
3. Wert eintragen → Banner verschwindet, Wert gespeichert
4. Nach ~55 Minuten → 1h-Prompt erscheint (falls 30min ausgefüllt)
5. `git add -A && git commit -m "feat: post-meal multi-timepoint glucose prompts (30min/1h/90min/2h/3h)" && git push origin main`

=== END ===
