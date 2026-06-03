---
name: Supabase Prod Queries
description: Wie man die Supabase Production-Datenbank von Replit aus abfragt
---

Die Supabase-Credentials sind in den **Replit Secrets** hinterlegt und als Shell-Umgebungsvariablen verfügbar.

**Richtig: via bash**
```bash
curl -s "${SUPABASE_URL}/rest/v1/profiles?select=push_token&user_id=eq.XYZ" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | python3 -m json.tool
```

User-ID aus E-Mail holen:
```bash
curl -s "${SUPABASE_URL}/auth/v1/admin/users?email=xyz@example.com" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['users'][0]['id'])"
```

**Nicht funktioniert:**
- `executeSql()` in code_execution → trifft die Replit-Dev-Postgres, nicht Supabase
- `viewEnvVars()` in code_execution → gibt für Secrets nur `true` (maskiert), keinen echten Wert
- `process.env` in code_execution → `process` ist undefined im sandbox
- `listConnections('supabase')` → 401

**Why:** Secrets sind nur als echte Env-Vars im bash-Prozess verfügbar, nicht im JS-Notebook-Sandbox.
