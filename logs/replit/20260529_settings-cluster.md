# Settings-Cluster-Accordion entfernt — flache Sektionsliste

## Was wurde geändert
`app/(protected)/settings/page.tsx`:
- `expandedCluster`-State, `toggleCluster`-Funktion und `CLUSTER_DEFS`-Array vollständig entfernt.
- Alle 6 Cluster-Toggle-Buttons (Konto, Glukose, Insulin, CGM, App, Mehr) und ihre `{expandedCluster === "X" && <> … </>}` Wrapper entfernt.
- Alle SettingsSections sind jetzt direkt sichtbar mit expliziten `title`-Props.

## Warum
User-Feedback: "Konto" erschien doppelt (Toggle-Button + Section-Titel), die Cluster-Buttons sahen ohne Karten-Hintergrund schlecht aus.
