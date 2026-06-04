#!/usr/bin/env bash
# verify-hypo-alarm.sh
#
# Mock-Verifikation für den Hypo-Alarm-Fix (Task #1212).
#
# Ablauf:
#   1. Hypo-Cooldown für Lucas löschen (damit der Alarm nicht geblockt ist)
#   2. Einen frischen apple_health_reading mit glucose=65 einfügen
#   3. hypo-check Edge Function manuell aufrufen
#   4. Antwort prüfen (expected: { checked: 1, sent: 1 })
#
# Voraussetzungen:
#   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY als Umgebungsvariablen gesetzt
#   - Lucas muss einen gültigen push_token haben (App öffnen → Auto-Register)
#   - Alarm muss aktiviert sein (low_alarm_enabled = true, low_alarm_threshold_mgdl = 70)
#
# Aufruf:
#   bash scripts/verify-hypo-alarm.sh
#
# Nach dem Aufruf sollte Lucas innerhalb von ~5 Sekunden eine Push-Benachrichtigung
# mit "🔴 Hypo-Alarm · 65 mg/dL" erhalten.

set -euo pipefail

LUCAS_ID="3e14dd7b-9da5-490d-821c-4becefadb238"
SUPABASE_FUNCTIONS_URL="https://zalpwyhlijbjyspjzbvn.supabase.co/functions/v1"

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"

echo "=== Hypo-Alarm Mock-Verifikation ==="
echo ""

# 1. Aktuellen Push-Token prüfen
echo "1. Push-Token prüfen..."
TOKEN_INFO=$(curl -s \
  "${SUPABASE_URL}/rest/v1/profiles?select=push_token,push_platform,push_token_updated_at&user_id=eq.${LUCAS_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")
echo "   → ${TOKEN_INFO}"

PUSH_TOKEN=$(echo "${TOKEN_INFO}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('push_token') or 'NULL')" 2>/dev/null || echo "NULL")
if [ "${PUSH_TOKEN}" = "NULL" ]; then
  echo ""
  echo "⚠️  KEIN PUSH-TOKEN — Lucas muss die App öffnen, damit sich der Token registriert."
  echo "   Nach dem App-Öffnen ca. 10 Sekunden warten, dann dieses Skript erneut ausführen."
  echo ""
  echo "   Debug-Tipp: localStorage.getItem('glev_push_step') und 'glev_push_error'"
  echo "   in der Glev-App-WebView prüfen (Safari DevTools → Simulator → Inspect)."
  exit 1
fi
echo "   ✓ Push-Token vorhanden (${PUSH_TOKEN:0:20}...)"

# 2. Cooldown löschen (damit der Alarm nicht durch einen früheren Push blockiert ist)
echo ""
echo "2. Hypo-Cooldown löschen..."
curl -s -X DELETE \
  "${SUPABASE_URL}/rest/v1/hypo_push_cooldown?user_id=eq.${LUCAS_ID}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -o /dev/null -w "   → HTTP %{http_code}\n"

# 3. Frische apple_health_reading mit 65 mg/dL einfügen
echo ""
echo "3. Mock-CGM-Reading einfügen (glucose=65 mg/dL)..."
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
INSERT_RESULT=$(curl -s -X POST \
  "${SUPABASE_URL}/rest/v1/apple_health_readings" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"user_id\":\"${LUCAS_ID}\",\"value_mg_dl\":65,\"timestamp\":\"${NOW}\"}")
echo "   → ${INSERT_RESULT}"

# 4. hypo-check manuell aufrufen
echo ""
echo "4. hypo-check Edge Function aufrufen..."
HYPO_RESULT=$(curl -s -X POST \
  "${SUPABASE_FUNCTIONS_URL}/hypo-check" \
  -H "Content-Type: application/json" \
  -w "\nHTTP %{http_code}")
echo "   → ${HYPO_RESULT}"

SENT=$(echo "${HYPO_RESULT}" | python3 -c "import json,sys; lines=sys.stdin.read().split('\n'); body=[l for l in lines if l.startswith('{')]; d=json.loads(body[0]) if body else {}; print(d.get('sent', '?'))" 2>/dev/null || echo "?")

echo ""
if [ "${SENT}" = "1" ]; then
  echo "✅ ALARM GESENDET — Lucas sollte jetzt eine Push-Benachrichtigung bekommen haben."
else
  echo "❌ Alarm wurde NICHT gesendet (sent=${SENT})."
  echo "   Supabase Edge Function Logs prüfen:"
  echo "   https://supabase.com/dashboard/project/zalpwyhlijbjyspjzbvn/functions/hypo-check/logs"
fi

# 5. Eingefügtes Mock-Reading aufräumen
echo ""
echo "5. Mock-Reading aufräumen..."
curl -s -X DELETE \
  "${SUPABASE_URL}/rest/v1/apple_health_readings?user_id=eq.${LUCAS_ID}&timestamp=eq.${NOW}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -o /dev/null -w "   → HTTP %{http_code}\n"
echo ""
echo "=== Fertig ==="
