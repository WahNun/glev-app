import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1a1a1a; background: #fff; padding: 48px 56px; line-height: 1.6; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 36px; }
  h3 { font-size: 15px; font-weight: 600; margin: 28px 0 10px; color: #111; }
  p { margin-bottom: 10px; color: #333; }
  .badge { display: inline-block; background: #f0f0f0; border-radius: 4px; padding: 1px 8px; font-size: 12px; font-family: monospace; color: #444; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 13px; }
  th { background: #f5f5f5; text-align: left; padding: 8px 12px; font-weight: 600; border: 1px solid #e0e0e0; }
  td { padding: 8px 12px; border: 1px solid #e0e0e0; }
  pre { background: #f8f8f8; border: 1px solid #e4e4e4; border-radius: 6px; padding: 16px; font-size: 12px; line-height: 1.7; font-family: 'SF Mono', 'Fira Code', monospace; margin: 12px 0 18px; white-space: pre-wrap; overflow-wrap: break-word; }
  .callout { background: #fff8e1; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 14px 0; font-size: 13px; color: #444; }
  .summary-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px 20px; margin-top: 32px; }
  .summary-box p { color: #166534; font-weight: 500; margin: 0; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 32px 0; }
  .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center; }
</style>
</head>
<body>

<h1>Der Nutrition-LRU-Cache — einfach erklärt</h1>
<p class="subtitle">Glev · Technischer Report · Juni 2026 · lib/nutrition/cache.ts</p>

<hr>

<h3>Wie heisst es?</h3>
<p><strong>LRU Cache</strong> (Least Recently Used) — der Code lebt in:</p>
<div class="badge">lib/nutrition/cache.ts</div>

<hr>

<h3>Was macht es?</h3>
<p>Wenn Glev eine Mahlzeit analysiert, fragt die App externe Datenbanken an — <strong>Open Food Facts</strong> (OFF) und <strong>USDA</strong> — um Nahrwerte fur Lebensmittel zu holen (Kohlenhydrate, Fett, Protein pro 100g).</p>
<p>Statt jedes Mal erneut im Internet nachzufragen, merkt sich der Cache die Antwort fur eine Weile:</p>

<table>
  <tr><th>Situation</th><th>Wie lange gespeichert</th></tr>
  <tr><td>Lebensmittel gefunden</td><td><strong>24 Stunden</strong></td></tr>
  <tr><td>Lebensmittel nicht gefunden</td><td><strong>1 Stunde</strong></td></tr>
  <tr><td>Abruf-Fehler (Timeout etc.)</td><td><strong>gar nicht</strong></td></tr>
</table>

<p>Der Cache fasst maximal <strong>1.000 Eintrage</strong>. Wenn er voll ist, fliegt der alteste Eintrag raus — daher &bdquo;Least Recently Used&ldquo;.</p>

<hr>

<h3>Warum haben wir das gebaut?</h3>
<p>Ein Nutzer loggt morgens Haferflocken ein. Der Server holt die Nahrwerte von OFF. Mittags loggt derselbe Nutzer (oder ein anderer auf demselben Server) wieder Haferflocken — ohne Cache wurde erneut eine HTTP-Anfrage rausgehen. Mit Cache: sofortige Antwort, kein Netzwerk-Round-Trip.</p>
<p>Das ist besonders wichtig, weil Glev <strong>Voice-Eingaben</strong> und <strong>Chat-Sessions</strong> hat, wo in kurzer Zeit viele Mahlzeiten geparst werden.</p>

<hr>

<h3>Warum brauchen wir dafur keine Datenbank oder Redis?</h3>

<div class="callout">
  Vercel serverless functions stay warm for several minutes between invocations on the same instance — even a humble in-memory cache absorbs most of the repeat hits from a single chat/voice-parse session.
</div>

<p>Auf Deutsch: Vercel halt denselben Server-Prozess fur mehrere Minuten warm. In dieser Zeit teilen sich alle Anfragen denselben Speicher — also denselben Cache. Das reicht vollig aus.</p>
<p>Ein Redis oder eine DB-Tabelle wurde dagegen bedeuten: extra Infrastruktur bezahlen, extra Verbindung bei jeder Anfrage, extra Ausfallrisiko. Und wenn der Cache doch mal kalt ist? Er fallt einfach durch zum echten API-Aufruf — kein Problem, keine Datenverluste.</p>

<hr>

<h3>Wie baut man das selbst?</h3>

<pre>// 1. Eine Map als Speicher
const cache = new Map();

// 2. Lesen
function get(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt &lt; Date.now()) return undefined;

  // LRU-Trick: loschen + neu einfugen = wird als frisch behandelt
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

// 3. Schreiben
function set(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });

  // Wenn zu gross → altesten rauswerfen
  if (cache.size > 1000) {
    cache.delete(cache.keys().next().value);
  }
}</pre>

<p>Das war's. Keine Bibliothek notig. <code>Map</code> erhalt in JavaScript die Einfuge-Reihenfolge — das macht das LRU-Prinzip mit <code>delete + set</code> trivial umsetzbar.</p>

<hr>

<div class="summary-box">
  <p>Zusammenfassung in einem Satz: Der Cache merkt sich fur 24 Stunden, was ein Lebensmittel wiegt — damit Glev nicht bei jeder Mahlzeit denselben API-Aufruf macht, und das vollig ohne Datenbank oder Extrakosten.</p>
</div>

<div class="footer">Glev · Technischer Report · Erstellt automatisch · Juni 2026</div>

</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'domcontentloaded' });
const pdf = await page.pdf({ format: 'A4', margin: { top: '20px', bottom: '20px', left: '0', right: '0' }, printBackground: true });
await browser.close();
writeFileSync('lru-cache-report.pdf', pdf);
console.log('done');
