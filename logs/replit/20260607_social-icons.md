# Fix Report — Social Media Icons im Footer

**Task:** Social-Media-Icons im Homepage-Footer
**Datum:** 2026-06-07

## Änderungen

- `app/page.tsx`: Instagram- und Facebook-Icon als inline SVG in den Homepage-Footer eingefügt
  - Instagram: https://www.instagram.com/glev.app/
  - Facebook: https://www.facebook.com/profile.php?id=61590224311735
  - 16×16px, var(--text-faint), target="_blank" rel="noopener noreferrer", aria-label
  - Keine externe Icon-Bibliothek benötigt

## Kein D-XXX nötig
Kein neuer Cloud-Service, kein Schema-Change, kein Auth-Prinzip geändert.
