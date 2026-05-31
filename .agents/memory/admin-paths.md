---
name: Admin Panel Paths
description: Das Admin Panel liegt unter /glev-ops/*, nicht /admin/*. Falsche Pfade brechen Links, Filter-Navigation und Next.js revalidatePath.
---

# Admin Panel Pfade

Das Admin Panel wurde von `/admin/*` auf `/glev-ops/*` umgezogen. `/admin/*` existiert **nicht mehr**.

## Korrekte Pfade

| Seite | Pfad |
|-------|------|
| Emails Preview | `/glev-ops/emails` |
| Drip Dashboard | `/glev-ops/drip` |
| Drip Stats | `/glev-ops/drip-stats` |
| Buyers | `/glev-ops/buyers` |
| Users | `/glev-ops/users` |
| Outbox | `/glev-ops/outbox` |
| Subscriptions | `/glev-ops/subscriptions` |

## Wo falsche Pfade auftauchen können

- `buildHref()`-Funktionen in Client-Komponenten (z.B. `EmailPreview.tsx`, `DripDashboard.tsx`, `BuyersTables.tsx`)
- `revalidatePath()` in Server Actions (`lib/admin/stripeActions.ts`)
- CTA-Links in Email-Templates (z.B. `lib/emails/drip-spike-alert.ts`)
- Kommentare in `page.tsx`-Dateien (unkritisch, aber irreführend)

**Why:** Bei jedem neuen Endpoint oder jeder neuen Verlinkung `/glev-ops/*` verwenden, niemals `/admin/*`.
