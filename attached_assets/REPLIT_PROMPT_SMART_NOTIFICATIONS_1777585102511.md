# Feature: Smart Notifications & Habit-Based Meal Reminders

## Kontext
Glev ist eine T1D-Diabetes-Management-App (Next.js, Supabase, React Native/Expo oder PWA).
Die App trackt bereits Glukosedaten und Mahlzeiten-Logs. Ziel: ein smartes Notification-System das aus dem Nutzerverhalten lernt.

---

## Was gebaut werden soll (5 Teile)

---

### Teil 1: Supabase DB-Migrations

```sql
-- Notification preferences pro User
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notif_critical_alerts boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_smart_reminders boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notif_quiet_start time DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS notif_quiet_end time DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS notif_reminder_sensitivity text DEFAULT 'medium';
  -- sensitivity: 'low' | 'medium' | 'high'

-- Tabelle für gelernte Mahlzeiten-Muster
CREATE TABLE IF NOT EXISTS meal_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  hour_of_day int NOT NULL,            -- 0–23
  day_of_week int,                     -- 0=So, 6=Sa, NULL = alle Tage
  frequency_score float DEFAULT 0,     -- wie oft dieser Slot auftritt (0–1)
  last_calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Tabelle: gesendete Notifications (um Duplikate zu vermeiden)
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,   -- 'critical_high' | 'critical_low' | 'meal_reminder'
  sent_at timestamptz DEFAULT now(),
  payload jsonb
);

-- Push token speichern
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS push_token text,
  ADD COLUMN IF NOT EXISTS push_platform text; -- 'expo' | 'web' | null
```

---

### Teil 2: Push Token Registration — `lib/notifications/registerToken.ts`

```ts
// lib/notifications/registerToken.ts
// Für Expo (React Native) — falls Web-only, Expo-Teil überspringen

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export async function registerPushToken(): Promise<string | null> {
  // 1. Permission anfragen
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  // 2. Expo Push Token holen
  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // 3. In Supabase speichern
  const supabase = createClientComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('profiles')
      .update({ push_token: token, push_platform: 'expo' })
      .eq('id', user.id);
  }

  // Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('glev-alerts', {
      name: 'Glev Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  return token;
}
```

---

### Teil 3: Pattern Detection — `lib/notifications/detectMealPatterns.ts`

```ts
// lib/notifications/detectMealPatterns.ts
// Läuft server-side (API route oder Cron). Analysiert meal_logs und berechnet Muster.

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MIN_ENTRIES_FOR_LEARNING = 14; // Mindestanzahl Mahlzeiten-Logs
const FREQUENCY_THRESHOLD = 0.4;     // Slot muss >40% der vergleichbaren Tage auftreten

export async function detectAndStoreMealPatterns(userId: string): Promise<void> {
  // 1. Mahlzeiten-Logs der letzten 60 Tage holen
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const { data: logs, error } = await supabaseAdmin
    .from('meal_logs')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error || !logs || logs.length < MIN_ENTRIES_FOR_LEARNING) {
    // Nicht genug Daten — keine Muster speichern
    return;
  }

  // 2. Stundenzählung
  const hourCounts: Record<number, number> = {};
  const totalDays = Math.ceil((Date.now() - since.getTime()) / (1000 * 60 * 60 * 24));

  for (const log of logs) {
    const hour = new Date(log.created_at).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }

  // 3. Alte Muster löschen
  await supabaseAdmin
    .from('meal_patterns')
    .delete()
    .eq('user_id', userId);

  // 4. Neue Muster eintragen
  const patterns = [];
  for (const [hourStr, count] of Object.entries(hourCounts)) {
    const hour = parseInt(hourStr);
    const frequency = count / totalDays;
    if (frequency >= FREQUENCY_THRESHOLD) {
      patterns.push({
        user_id: userId,
        hour_of_day: hour,
        frequency_score: parseFloat(frequency.toFixed(2)),
        last_calculated_at: new Date().toISOString(),
      });
    }
  }

  if (patterns.length > 0) {
    await supabaseAdmin.from('meal_patterns').insert(patterns);
  }
}
```

---

### Teil 4: Notification Sender — `lib/notifications/sendNotification.ts`

```ts
// lib/notifications/sendNotification.ts
// Sendet Push via Expo Push API. Loggt in notification_log um Duplikate zu vermeiden.

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotifType = 'critical_high' | 'critical_low' | 'meal_reminder';

interface SendOptions {
  userId: string;
  pushToken: string;
  type: NotifType;
  title: string;
  body: string;
  dedupeWindowMinutes?: number; // Keine erneute Notification innerhalb dieses Zeitfensters
}

export async function sendPushNotification(opts: SendOptions): Promise<void> {
  const { userId, pushToken, type, title, body, dedupeWindowMinutes = 60 } = opts;

  // Dedupe-Check: Wurde dieselbe Notification-Type kürzlich gesendet?
  const cutoff = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('sent_at', cutoff)
    .limit(1);

  if (recent && recent.length > 0) return; // Bereits gesendet — überspringen

  // Senden via Expo Push API
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: pushToken,
      title,
      body,
      sound: 'default',
      priority: type.startsWith('critical') ? 'high' : 'normal',
      data: { type },
    }),
  });

  // Log schreiben
  await supabaseAdmin.from('notification_log').insert({
    user_id: userId,
    type,
    payload: { title, body },
  });
}
```

---

### Teil 5: Cron API Route — `app/api/notifications/check/route.ts`

```ts
// app/api/notifications/check/route.ts
// Diese Route per Cron alle 30 Minuten aufrufen (z.B. via Vercel Cron oder externen Cron-Service).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/lib/notifications/sendNotification';
import { detectAndStoreMealPatterns } from '@/lib/notifications/detectMealPatterns';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Schutz: nur autorisierte Cron-Aufrufe
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Alle User mit Push-Token und aktivierten Notifications holen
  const { data: users } = await supabaseAdmin
    .from('profiles')
    .select('id, push_token, push_platform, notif_critical_alerts, notif_smart_reminders, notif_quiet_start, notif_quiet_end')
    .not('push_token', 'is', null);

  if (!users) return NextResponse.json({ ok: true, processed: 0 });

  for (const user of users) {
    if (!user.push_token) continue;

    // Quiet-Hours prüfen
    const quietStart = parseInt((user.notif_quiet_start || '22:00').split(':')[0]);
    const quietEnd = parseInt((user.notif_quiet_end || '07:00').split(':')[0]);
    const inQuietHours =
      quietStart > quietEnd
        ? currentHour >= quietStart || currentHour < quietEnd
        : currentHour >= quietStart && currentHour < quietEnd;

    // 1. Kritische Alerts: Glukose-Check
    if (user.notif_critical_alerts && !inQuietHours) {
      const { data: latestBg } = await supabaseAdmin
        .from('cgm_readings')
        .select('sgv, direction, date')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (latestBg) {
        const bgAge = Date.now() - new Date(latestBg.date).getTime();
        const isFresh = bgAge < 10 * 60 * 1000; // max 10 Min alt

        if (isFresh && latestBg.sgv < 70) {
          await sendPushNotification({
            userId: user.id,
            pushToken: user.push_token,
            type: 'critical_low',
            title: '⚠️ Niedriger Blutzucker',
            body: `Dein BZ liegt bei ${latestBg.sgv} mg/dL. Bitte handeln!`,
            dedupeWindowMinutes: 20,
          });
        } else if (isFresh && latestBg.sgv > 250) {
          await sendPushNotification({
            userId: user.id,
            pushToken: user.push_token,
            type: 'critical_high',
            title: '⬆️ Hoher Blutzucker',
            body: `Dein BZ liegt bei ${latestBg.sgv} mg/dL. Korrektur prüfen.`,
            dedupeWindowMinutes: 30,
          });
        }
      }
    }

    // 2. Smart Meal Reminders
    if (user.notif_smart_reminders && !inQuietHours) {
      // Muster neu berechnen (nur einmal täglich nötig — hier vereinfacht)
      await detectAndStoreMealPatterns(user.id);

      // Muster für aktuelle Stunde prüfen
      const { data: patterns } = await supabaseAdmin
        .from('meal_patterns')
        .select('frequency_score')
        .eq('user_id', user.id)
        .eq('hour_of_day', currentHour)
        .gte('frequency_score', 0.4);

      if (patterns && patterns.length > 0 && currentMinute < 15) {
        // Hat der User in dieser Stunde schon geloggt?
        const windowStart = new Date();
        windowStart.setMinutes(0, 0, 0);
        const { data: recentMeal } = await supabaseAdmin
          .from('meal_logs')
          .select('id')
          .eq('user_id', user.id)
          .gte('created_at', windowStart.toISOString())
          .limit(1);

        if (!recentMeal || recentMeal.length === 0) {
          const messages = [
            'Du isst normalerweise um diese Zeit. Vergiss dein Logging nicht! 🍽️',
            'Zeit für deine übliche Mahlzeit — willst du jetzt loggen?',
            'Dein Blutzucker-Copilot erinnert dich: Mahlzeit-Zeit!',
          ];
          const msg = messages[Math.floor(Math.random() * messages.length)];

          await sendPushNotification({
            userId: user.id,
            pushToken: user.push_token,
            type: 'meal_reminder',
            title: '🥗 Mahlzeit-Erinnerung',
            body: msg,
            dedupeWindowMinutes: 90,
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, processed: users.length });
}
```

---

### Teil 6: Settings UI — Notification Section in `app/(protected)/settings/page.tsx`

In der Settings-Seite einen neuen Abschnitt **"Benachrichtigungen"** hinzufügen:

```tsx
import { useNotificationSettings } from '@/hooks/useNotificationSettings';

// Hook anlegen unter hooks/useNotificationSettings.ts — analog zu useCarbUnit
// Liest/schreibt notif_* Spalten aus profiles

// UI-Section:
<section>
  <h3 style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
    BENACHRICHTIGUNGEN
  </h3>

  {/* Critical Alerts */}
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #2a2a2a' }}>
    <div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>⚠️ Kritische Alerts</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>Hypo- und Hyperglykämie-Warnungen</div>
    </div>
    <input
      type="checkbox"
      checked={settings.notif_critical_alerts}
      onChange={(e) => updateSetting('notif_critical_alerts', e.target.checked)}
    />
  </div>

  {/* Smart Reminders */}
  <div style={{ padding: '12px 0', borderBottom: '1px solid #2a2a2a' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>🧠 Smarte Mahlzeit-Erinnerungen</div>
        <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
          {hasEnoughData
            ? 'Aktiv — basiert auf deinen Gewohnheiten'
            : 'Noch in Lernphase — aktiviert nach 14 Tagen'}
        </div>
      </div>
      <input
        type="checkbox"
        checked={settings.notif_smart_reminders}
        disabled={!hasEnoughData}
        onChange={(e) => updateSetting('notif_smart_reminders', e.target.checked)}
      />
    </div>
    {!hasEnoughData && (
      <div style={{ fontSize: 12, color: '#4F6EF7', marginTop: 6 }}>
        🔄 Glev lernt noch deine Muster. Noch {daysUntilReady} Tage.
      </div>
    )}
  </div>

  {/* Quiet Hours */}
  <div style={{ padding: '12px 0' }}>
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>🌙 Ruhezeiten</div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: '#aaa' }}>
      <span>Keine Notifications von</span>
      <input type="time" value={settings.notif_quiet_start} onChange={(e) => updateSetting('notif_quiet_start', e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '4px 8px', borderRadius: 6 }} />
      <span>bis</span>
      <input type="time" value={settings.notif_quiet_end} onChange={(e) => updateSetting('notif_quiet_end', e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '4px 8px', borderRadius: 6 }} />
    </div>
  </div>
</section>
```

---

### Teil 7: Cron konfigurieren — `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/notifications/check",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

Und in `.env.local` / Replit Secrets:
```
CRON_SECRET=<zufälliger-langer-string>
```

---

## Reihenfolge der Implementierung

1. Supabase Migrations ausführen
2. `lib/notifications/sendNotification.ts` anlegen
3. `lib/notifications/detectMealPatterns.ts` anlegen
4. `lib/notifications/registerToken.ts` anlegen (falls Expo/Native)
5. `app/api/notifications/check/route.ts` anlegen
6. `hooks/useNotificationSettings.ts` anlegen (analog useCarbUnit)
7. Settings-Seite: Benachrichtigungs-Section einbauen
8. `vercel.json` Cron anlegen + CRON_SECRET in Secrets setzen
9. Push-Token-Registration beim App-Start aufrufen (nach Login)
10. `tsc --noEmit` — clean
11. `git add -A && git commit -m "feat: smart notifications + habit-based meal reminders" && git push origin main`

---

## Was NICHT geändert wird
- Bestehende Alert-Logik bleibt unberührt
- Mahlzeiten-Logs werden nur gelesen, nicht verändert
- Kein Breaking Change an bestehenden Daten
- Alle medizinischen Aussagen bleiben Hinweise/Erinnerungen — keine klinischen Dosierungsempfehlungen in Notifications
