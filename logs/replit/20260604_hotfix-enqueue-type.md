# Hotfix: Vercel-Build-Fehler — PasswordResetDeps.enqueue-Typ zu loose

**Datum:** 2026-06-04  
**Typ:** Hotfix (kein Asana-Task)

## Problem

Vercel-Build fehlgeschlagen beim TypeScript-Check:

```
app/api/auth/password-reset/route.ts:122:55
Type error: Type '<T extends EmailTemplate>(...) => Promise<{ id: string; deduplicated: boolean }>'
is not assignable to type '(...) => Promise<void>'.
```

`PasswordResetDeps.enqueue` war als `(args: { template: string; ... }) => Promise<void>` typisiert — zu unspezifisch für `enqueueEmail`, das generisch `<T extends EmailTemplate>` ist und `Promise<{ id: string; deduplicated: boolean }>` zurückgibt.

## Fix

**`app/api/auth/password-reset/route.ts`**: `enqueue`-Typ auf `typeof enqueueEmail` geändert.

**`tests/unit/passwordResetRoute.test.ts`**:
- Mock-Funktion gibt jetzt `{ id: "test-id", deduplicated: false }` zurück
- `display_name: null` → `undefined` (passt zu `string | undefined`-Typ)
- `PasswordResetPayload`-Import für Payload-Cast in Assertion ergänzt
