# Glev CGM Server

Multi-user Node.js (Express) proxy that fetches glucose readings from
LibreLinkUp on behalf of authenticated Supabase users.

- Stateless w.r.t. user passwords (AES-256-GCM at rest in Supabase).
- Two-layer cache: in-process L1 + Supabase L2, sub-400 ms warm reads.
- All `/cgm/*` routes require `Authorization: Bearer <supabase_jwt>`.

---

## Required env vars

Copy `.env.example` to `.env` and fill in:

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service role (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Used to verify user JWTs |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM password storage |
| `PORT` | Optional (defaults to 8080) |

Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Supabase table

```sql
-- Run once in the Supabase SQL editor.
create table if not exists public.cgm_credentials (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  llu_email                 text not null,
  llu_password_encrypted    text not null,           -- iv:authTag:ciphertext (hex)
  llu_region                text not null default 'eu',
  cached_token              text,
  cached_token_expires      timestamptz,
  cached_patient_id         text,
  cached_account_id_hash    text,
  updated_at                timestamptz not null default now()
);

-- RLS: only the owner can see/manage their own row from a client.
-- The server uses the service role key, which bypasses RLS.
alter table public.cgm_credentials enable row level security;

create policy "own row select" on public.cgm_credentials
  for select using (auth.uid() = user_id);
create policy "own row modify" on public.cgm_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## Run

```bash
cd cgm-server
npm install
npm start
# → [cgm] listening on :8080
```

---

## Endpoints

All `/cgm/*` endpoints require `Authorization: Bearer <SUPABASE_JWT>`.

### `POST /cgm/credentials`

Stores (encrypted) LibreLinkUp credentials for the authed user.

```bash
curl -X POST http://localhost:8080/cgm/credentials \
  -H "Authorization: Bearer $SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"hunter2","region":"eu"}'
# → {"ok":true}
```

### `DELETE /cgm/credentials`

Removes the stored row and clears the in-memory cache for this user.

```bash
curl -X DELETE http://localhost:8080/cgm/credentials \
  -H "Authorization: Bearer $SUPABASE_JWT"
# → {"ok":true}
```

### `GET /cgm/latest`

Fast path — single LLU `GET /llu/connections` call.

```bash
curl http://localhost:8080/cgm/latest \
  -H "Authorization: Bearer $SUPABASE_JWT"
# → {"current":{"value":127,"unit":"mg/dL","timestamp":"...","trend":"stable"}}
```

### `GET /cgm/history`

Includes the per-patient `/graph` history.

```bash
curl http://localhost:8080/cgm/history \
  -H "Authorization: Bearer $SUPABASE_JWT"
# → {"current":{...},"history":[{...}, ...]}
```

### `GET /health`

Public.

```bash
curl http://localhost:8080/health
# → {"ok":true}
```

---

## Error codes

| Status | Meaning |
| --- | --- |
| 400 | bad request body |
| 401 | missing/invalid Supabase JWT |
| 404 | no credentials stored for this user |
| 502 | LibreLinkUp upstream error |
| 504 | LibreLinkUp timeout |

Error body is always `{ "error": "..." }`.

---

## Trend mapping

`TrendArrow` from LLU → string used in responses:

| Code | Trend |
| --- | --- |
| 1 | `fallingQuickly` |
| 2 | `falling` |
| 3 | `stable` |
| 4 | `rising` |
| 5 | `risingQuickly` |
