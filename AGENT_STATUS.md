STATUS: DONE (Mobile-Layout-Fixes /log) — Hot-reload aktiv, kein Restart nötig
LAST_DONE:
  3 Mobile-Layout-Fixes für /log (Step 1):
  #1 Pills weiter weg vom Engine-Chip — marginTop:14 auf den Pill-Tab-Container hinzugefügt. Vorher klebten [1 Essen | 2 Makros | 3 Ergebnis] direkt unter dem Workspace-Artifact-Chip "Engine". Jetzt 14px Luft + Comment.
  #2 Chat-Panel auf Mobile sichtbar (vorher hatte ich display:none gesetzt — User will Chat aber sehen).
  #3 Chat-Panel adaptiv: füllt jetzt den ganzen Raum zwischen AI-Parser-Chip und Bottom-Footer-Nav.
     - .log-grid auf Mobile: display:flex, flex-direction:column, min-height:calc(100dvh - 240px) — die 240px decken Workspace-Header (~116) + Page-H1+Pills (~60) + Footer-Nav mit Safe-Area (~80) + 24px Slack für Notch-Devices.
     - .log-grid > div:first-child (left col): flex:0 0 auto — nimmt nur Natural-Height, der Rest geht an chat-col.
     - .chat-col auf Mobile: position:static, height:auto, max-height:none, min-height:240px (Floor), flex:1 1 auto, display:flex.
     - !important nötig weil chat-col Inline-Styles für Desktop trägt (height:calc(100vh-180px), maxHeight:760, minHeight:420) die sonst die Cascade gewinnen.
     - Nutzt 100dvh statt 100vh wegen iOS Safari URL-Bar-Verhalten.
  tsc clean.

NEXT:
  a) USER testen auf Replit-Preview (Hot-Reload sollte Änderungen sofort zeigen — Browser hard-refresh falls nicht)
  b) Falls Layout passt: Push nach main (User-Auth erforderlich)
  c) Restschritte aus Option A bleiben offen: /engine cleanen + /log?type=insulin/exercise Sub-Flow

QUESTION: Layout jetzt richtig auf Handy? Push freigeben?
TIMESTAMP: 23:25
