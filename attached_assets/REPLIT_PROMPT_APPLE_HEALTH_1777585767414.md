# Feature: Apple Health Integration (HealthKit CGM-Lesezugriff)

## Kontext & Stack
- **App:** Next.js + Capacitor iOS (kein Expo, kein React Native)
- **Ziel:** Blutglukose-Readings aus Apple Health lesen und in den bestehenden Glev CGM-Datenfluss einspeisen
- **Keine API-Approval nötig** — HealthKit ist eine lokale iOS-Schnittstelle
- **Scope:** Nur lesend. Kein Schreiben in Apple Health, kein Android, kein Apple Watch Standalone
- **Bestehende CGM-Architektur:** `lib/cgm/index.ts` als Dispatcher → `lib/cgm/llu.ts` (LibreLinkUp) und `lib/cgm/nightscout.ts` (Nightscout). Apple Health wird als dritter Provider eingehängt — selber Output-Shape.

---

## Was gebaut wird (5 Schritte)

---

### Schritt 1: Capacitor HealthKit Plugin installieren

Im Replit-Terminal:

```bash
npm install @capacitor-community/health-kit
npx cap sync ios
```

In `ios/App/App/Info.plist` folgende Keys hinzufügen (falls nicht vorhanden):

```xml
<key>NSHealthShareUsageDescription</key>
<string>Glev liest deine Blutglukosewerte aus Apple Health, um dir personalisierte Insulin-Empfehlungen zu geben.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Glev schreibt keine Daten in Apple Health.</string>
```

In `ios/App/App/AppDelegate.swift` prüfen ob HealthKit-Capability aktiviert ist — falls nicht, in Xcode unter Signing & Capabilities → HealthKit hinzufügen.

---

### Schritt 2: Apple Health Provider — `lib/cgm/appleHealth.ts`

Neue Datei anlegen:

```ts
// lib/cgm/appleHealth.ts
// Liest Blutglukose-Readings aus Apple Health (HealthKit) via Capacitor Plugin.
// Output-Shape ist identisch mit llu.ts und nightscout.ts — kein neuer Datenpfad nötig.

import { Capacitor } from '@capacitor/core';

// Nur im nativen iOS-Kontext verfügbar
const isNative = Capacitor.isNativePlatform();

export interface CgmReading {
  sgv: number;        // mg/dL (intern immer mg/dL)
  date: number;       // Unix-Timestamp in ms
  direction?: string; // 'Flat' | 'FortyFiveUp' | 'FortyFiveDown' | etc. (optional bei AH)
  source: 'apple_health';
}

// Prüft ob HealthKit auf diesem Gerät verfügbar und authorisiert ist
export async function isAppleHealthAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { HealthKit } = await import('@capacitor-community/health-kit');
    const result = await HealthKit.isAvailable();
    return result.value === true;
  } catch {
    return false;
  }
}

// Permission anfragen (nur einmal nötig, iOS merkt sich die Entscheidung)
export async function requestAppleHealthPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { HealthKit } = await import('@capacitor-community/health-kit');
    await HealthKit.requestAuthorization({
      all: [],
      read: ['HKQuantityTypeIdentifierBloodGlucose'],
    });
    return true;
  } catch {
    return false;
  }
}

// Letzte N Stunden Blutglukose-Readings lesen
export async function getAppleHealthReadings(hoursBack: number = 3): Promise<CgmReading[]> {
  if (!isNative) return [];
  try {
    const { HealthKit } = await import('@capacitor-community/health-kit');

    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    const result = await HealthKit.queryHKitSampleType({
      sampleName: 'bloodGlucose',
      startDate,
      endDate,
      limit: 100,
    });

    if (!result?.resultData) return [];

    return result.resultData
      .map((sample: any) => {
        // HealthKit gibt Blutglukose in mmol/L zurück — in mg/dL umrechnen
        const mmol = parseFloat(sample.quantity);
        const mgdl = Math.round(mmol * 18.0182);

        return {
          sgv: mgdl,
          date: new Date(sample.startDate).getTime(),
          direction: undefined, // Apple Health hat keine Trend-Direction
          source: 'apple_health' as const,
        };
      })
      .filter((r: CgmReading) => r.sgv > 0)
      .sort((a: CgmReading, b: CgmReading) => b.date - a.date); // Neueste zuerst
  } catch (e) {
    console.error('[AppleHealth] getAppleHealthReadings error:', e);
    return [];
  }
}

// Aktuellen BZ-Wert (letzter Reading) holen
export async function getLatestAppleHealthReading(): Promise<CgmReading | null> {
  const readings = await getAppleHealthReadings(1);
  return readings.length > 0 ? readings[0] : null;
}
```

---

### Schritt 3: CGM-Dispatcher erweitern — `lib/cgm/index.ts`

In der bestehenden Datei `lib/cgm/index.ts` Apple Health als dritten Provider einbinden.

**Bestehende Struktur (Referenz):**
```ts
// Aktuell in lib/cgm/index.ts:
export async function getLatestReading(userId: string) {
  // ruft LLU oder Nightscout auf je nach cgm_type in profiles
}

export async function getHistory(userId: string, hours: number) {
  // ruft LLU oder Nightscout auf
}
```

**Änderungen:**

```ts
// lib/cgm/index.ts — bestehende Imports behalten, ergänzen:
import { getLatestAppleHealthReading, getAppleHealthReadings, isAppleHealthAvailable } from './appleHealth';

// In getLatestReading(): Apple Health als dritter Case
export async function getLatestReading(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('cgm_type, nightscout_url, nightscout_token_enc, llu_email, llu_password_enc')
    .eq('id', userId)
    .single();

  if (!profile) return null;

  // NEUER CASE:
  if (profile.cgm_type === 'apple_health') {
    return await getLatestAppleHealthReading();
  }

  // Bestehende Cases bleiben unverändert:
  if (profile.cgm_type === 'nightscout') {
    return await getNightscoutLatest(profile);
  }
  if (profile.cgm_type === 'llu') {
    return await getLluLatest(profile);
  }

  return null;
}

// In getHistory(): Apple Health als dritter Case
export async function getHistory(userId: string, hours: number = 3) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('cgm_type, nightscout_url, nightscout_token_enc, llu_email, llu_password_enc')
    .eq('id', userId)
    .single();

  if (!profile) return [];

  // NEUER CASE:
  if (profile.cgm_type === 'apple_health') {
    return await getAppleHealthReadings(hours);
  }

  // Bestehende Cases unverändert...
}
```

---

### Schritt 4: Supabase — cgm_type Wert hinzufügen

Apple Health als gültiger `cgm_type` in der profiles-Tabelle:

```sql
-- Kein neues Spaltentyp nötig — cgm_type ist text, 'apple_health' ist einfach ein neuer Wert.
-- Zur Dokumentation: gültige Werte sind jetzt:
-- 'none' | 'llu' | 'nightscout' | 'apple_health'

-- Falls ein CHECK constraint existiert, anpassen:
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_cgm_type_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_cgm_type_check
  CHECK (cgm_type IN ('none', 'llu', 'nightscout', 'apple_health'));
```

---

### Schritt 5: Settings UI — Apple Health Option in CgmSettingsCard

In der bestehenden `CgmSettingsCard`-Komponente (vermutlich in `components/settings/CgmSettingsCard.tsx` oder `app/(protected)/settings/page.tsx`):

**In der CGM-Typ-Auswahl Apple Health als Option hinzufügen:**

```tsx
import { isAppleHealthAvailable, requestAppleHealthPermission } from '@/lib/cgm/appleHealth';
import { Capacitor } from '@capacitor/core';

// Im Component:
const isNative = Capacitor.isNativePlatform();
const [ahAvailable, setAhAvailable] = useState(false);

useEffect(() => {
  isAppleHealthAvailable().then(setAhAvailable);
}, []);

const handleSelectAppleHealth = async () => {
  const granted = await requestAppleHealthPermission();
  if (granted) {
    await updateCgmType('apple_health'); // bestehende Funktion die cgm_type in profiles updated
  } else {
    alert('Apple Health Zugriff wurde verweigert. Bitte in iOS Einstellungen → Datenschutz → Gesundheit aktivieren.');
  }
};

// In der CGM-Typ-Auswahl UI (bestehende Struktur beibehalten, Option ergänzen):
{isNative && ahAvailable && (
  <button
    onClick={handleSelectAppleHealth}
    style={{
      background: cgmType === 'apple_health' ? '#4F6EF7' : 'transparent',
      color: cgmType === 'apple_health' ? 'white' : '#4F6EF7',
      border: '1px solid #4F6EF7',
      borderRadius: 8,
      padding: '10px 16px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}
  >
    <span>🍎</span>
    <div>
      <div style={{ fontWeight: 600 }}>Apple Health</div>
      <div style={{ fontSize: 11, opacity: 0.8 }}>Libre 3, Dexcom G7 + alle CGMs</div>
    </div>
  </button>
)}

{/* Hinweis wenn Apple Health aktiv aber kein nativer Kontext (Web-Preview) */}
{cgmType === 'apple_health' && !isNative && (
  <p style={{ fontSize: 12, color: '#f85149', marginTop: 8 }}>
    Apple Health ist nur in der iOS-App verfügbar.
  </p>
)}
```

---

## Was NICHT geändert wird
- Bestehende LLU- und Nightscout-Pfade bleiben komplett unberührt
- DB-Schema: kein neues Spalten, nur neuer `cgm_type`-Wert
- Keine Server-Side-Logik — HealthKit läuft vollständig client-seitig auf dem iOS-Gerät
- Kein Schreiben in Apple Health
- Keine Background-Sync-Jobs (Apple Health wird on-demand gelesen, genau wie LLU/Nightscout)

---

## Reihenfolge

1. `npm install @capacitor-community/health-kit && npx cap sync ios`
2. `Info.plist` Keys hinzufügen
3. HealthKit Capability in Xcode aktivieren
4. `lib/cgm/appleHealth.ts` anlegen
5. `lib/cgm/index.ts` — Apple Health Cases einbauen
6. Supabase: CHECK constraint prüfen / anpassen
7. Settings UI: Apple Health Button in CgmSettingsCard
8. Auf physischem iPhone testen (HealthKit funktioniert nicht im Simulator)
9. `tsc --noEmit` — clean
10. `git add -A && git commit -m "feat: Apple Health HealthKit CGM integration" && git push origin main`

---

## Wichtige Hinweise für den Agenten

- **Simulator:** HealthKit-Daten sind im Xcode-Simulator nicht verfügbar — Test zwingend auf physischem iPhone
- **mmol/L → mg/dL:** HealthKit gibt Blutglukose immer in mmol/L zurück. Faktor: `mmol * 18.0182 = mg/dL`
- **Permission-Flow:** iOS fragt den User einmalig — danach merkt sich das System die Entscheidung. Bei Ablehnung muss der User manuell zu iOS Einstellungen → Datenschutz → Gesundheit → Glev gehen
- **Kein Trend/Direction:** Apple Health speichert keine CGM-Trendpfeile — `direction` bleibt `undefined`. Die UI muss das graceful handhaben (kein Pfeil anzeigen)
- **Plugin-Import:** `@capacitor-community/health-kit` dynamisch importieren (`import(...)`) damit der Web-Build nicht bricht
