# Hybrid Cron Setup — manuelle Schritte

## Layer A: Vercel Cron (bereits im Code)

Drei neue API Routes unter `app/api/cron/{hypo,elevated,hyper}-check/route.ts` und Einträge in `vercel.json` sind committed. Nach dem Deploy laufen die Crons automatisch — ABER nur wenn `CRON_SECRET` als Env-Var gesetzt ist.

**Schritt 1:** Vercel Dashboard → Settings → Environment Variables
- `CRON_SECRET` = Output von `openssl rand -hex 32`
- `SUPABASE_URL` muss bereits gesetzt sein (prüfen)

Nach dem nächsten Deploy: Vercel Dashboard → Crons → die drei neuen Einträge sollten als „Healthy" erscheinen.

## Layer B: pg_cron in Supabase (manuell ausführen)

**Schritt 2:** Datei `supabase/migrations/20260606_hybrid_cron.sql` öffnen

**Schritt 3:** `YOUR_SUPABASE_URL_HERE` in allen drei `net.http_post`-Aufrufen ersetzen.
Den Wert findest du: Supabase Dashboard → Settings → API → Project URL
(Format: `https://abcdefghijklm.supabase.co`)

**Schritt 4:** Im Supabase SQL Editor ausführen (nicht als reguläre Migration — pg_cron ist DB-Admin-Scope).

**Schritt 5:** Verifizieren mit der letzten SELECT-Zeile im SQL — sollte 3 Zeilen zurückgeben.

## Resultat: Defense-in-Depth

| Layer | Trigger | Frequenz |
|---|---|---|
| Vercel Cron | HTTP GET → Edge Function | 1x/min |
| pg_cron | `net.http_post` → Edge Function | 1x/min |
| GitHub Actions | HTTP POST → Edge Function | ~3x/h (bleibt als 3rd Layer) |
| Healthchecks.io | Watchdog-Ping von Edge Function | validiert ob Runs ankommen |
