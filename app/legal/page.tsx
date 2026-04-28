"use client";

import { useState } from "react";
import Link from "next/link";

type Tab = "dse" | "agb";

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>("dse");

  return (
    <div className="glev-legal">
      <style>{LEGAL_CSS}</style>

      <header className="gl-header">
        <div className="app-name">Glev · Compliance</div>
        <h1>Rechtliche Dokumente</h1>
        <nav className="tab-bar" role="tablist" aria-label="Dokument-Tabs">
          <button
            className={`tab-btn ${tab === "dse" ? "active" : ""}`}
            role="tab"
            aria-selected={tab === "dse"}
            aria-controls="panel-dse"
            id="tab-dse"
            onClick={() => { setTab("dse"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            Datenschutzerklärung
          </button>
          <button
            className={`tab-btn ${tab === "agb" ? "active" : ""}`}
            role="tab"
            aria-selected={tab === "agb"}
            aria-controls="panel-agb"
            id="tab-agb"
            onClick={() => { setTab("agb"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            AGB
          </button>
        </nav>
      </header>

      {/* ─── DSE ─────────────────────────────────────────────── */}
      <div
        className={`tab-panel ${tab === "dse" ? "active" : ""}`}
        id="panel-dse"
        role="tabpanel"
        aria-labelledby="tab-dse"
      >
        <div className="meta-strip">Stand: April 2026 &nbsp;·&nbsp; DSGVO-konform</div>
        <div className="container">
          <div className="intro-box">
            Der Schutz deiner persönlichen Daten – insbesondere deiner Gesundheitsdaten – ist uns ein zentrales Anliegen. Diese Datenschutzerklärung informiert dich darüber, welche Daten wir erheben, wie wir sie verarbeiten und welche Rechte du hast.
          </div>

          <section id="dse-1">
            <h2><span className="num">1</span> Verantwortlicher</h2>
            <p>Verantwortlicher im Sinne der DSGVO ist:</p>
            <div className="contact-block">
              <strong>Lucas Rolleke Pinto Wahnon</strong><br />
              Einzelunternehmer (Freiberufler / Recibo Verde)<br />
              Lissabon, Portugal<br />
              E-Mail: <a href="mailto:info@glev.app">info@glev.app</a><br />
              Website: <a href="https://glev.app" target="_blank" rel="noopener">glev.app</a>
            </div>
          </section>

          <section id="dse-2">
            <h2><span className="num">2</span> Welche Daten wir erheben und warum</h2>

            <h3>2.1 Kontodaten</h3>
            <p>Beim Anlegen eines Glev-Kontos erheben wir deine <strong>E-Mail-Adresse</strong> und ein Passwort (verschlüsselt gespeichert). Diese Daten sind zur Bereitstellung des Dienstes und Kontoverwaltung notwendig.</p>

            <h3>2.2 Gesundheits- und Nutzungsdaten</h3>
            <p>Im Rahmen der App-Nutzung erfasst Glev folgende Daten, die du aktiv eingibst oder über eine CGM-Verknüpfung überträgst:</p>
            <ul>
              <li><strong>Glukosewerte</strong> (manuell eingetragen oder per CGM-Anbindung)</li>
              <li><strong>Mahlzeiten</strong> (Makronährstoffe: Kohlenhydrate, Protein, Fett, Kalorien)</li>
              <li><strong>Symptome</strong> (z. B. Wohlbefinden, Unterzuckerungssymptome)</li>
              <li><strong>Optionale CGM-Verknüpfungsdaten</strong> (sofern du eine CGM-Integration aktivierst)</li>
            </ul>

            <div className="highlight-box">
              <strong>⚠️ Besondere Kategorien – Gesundheitsdaten (Art. 9 DSGVO)</strong>
              Glukosewerte, Symptome und CGM-Daten gelten als Gesundheitsdaten – eine besonders sensible Datenkategorie. Wir verarbeiten diese ausschließlich auf Grundlage deiner <strong>ausdrücklichen Einwilligung</strong> (Art. 9 Abs. 2 lit. a DSGVO), die du bei der Registrierung erteilst. Du kannst die Einwilligung jederzeit durch Kontolöschung widerrufen.
            </div>

            <h3>2.3 Zahlungsdaten</h3>
            <p>Bei Abonnements wickelt <strong>Stripe</strong> die Zahlung ab. Glev speichert keine Zahlungskartendaten. Stripe verarbeitet diese als eigenständig Verantwortlicher gemäß seiner eigenen Datenschutzrichtlinie.</p>

            <h3>2.4 Technische Verbindungsdaten</h3>
            <p>Beim Aufruf der App werden technisch notwendige Verbindungsdaten (IP-Adresse, Zeitstempel) von unseren Hosting-Diensten kurzzeitig verarbeitet. Diese werden nicht für Tracking oder Analyse genutzt.</p>
          </section>

          <section id="dse-3">
            <h2><span className="num">3</span> Rechtsgrundlagen</h2>
            <table>
              <thead><tr><th>Datenart</th><th>Rechtsgrundlage</th></tr></thead>
              <tbody>
                <tr><td>Kontodaten (E-Mail, Passwort)</td><td>Art. 6 Abs. 1 lit. b DSGVO – Vertragserfüllung</td></tr>
                <tr><td>Zahlungsabwicklung via Stripe</td><td>Art. 6 Abs. 1 lit. b DSGVO – Vertragserfüllung</td></tr>
                <tr><td>Gesundheitsdaten (Glukose, Symptome, Mahlzeiten)</td><td>Art. 9 Abs. 2 lit. a DSGVO – Ausdrückliche Einwilligung</td></tr>
                <tr><td>Technische Verbindungsdaten</td><td>Art. 6 Abs. 1 lit. f DSGVO – Berechtigte Interessen (sicherer Betrieb)</td></tr>
              </tbody>
            </table>
          </section>

          <section id="dse-4">
            <h2><span className="num">4</span> Auftragsverarbeiter &amp; Drittlandtransfer</h2>
            <p>Folgende Dienstleister werden auf Basis von Auftragsverarbeitungsverträgen (AVV, Art. 28 DSGVO) eingesetzt:</p>
            <table>
              <thead><tr><th>Dienstleister</th><th>Zweck</th><th>Standort</th><th>Drittland</th></tr></thead>
              <tbody>
                <tr><td><strong>Supabase, Inc.</strong></td><td>Datenbank, Authentifizierung</td><td>EU (Frankfurt)</td><td><span className="badge">EU-Region</span></td></tr>
                <tr><td><strong>Vercel, Inc.</strong></td><td>Hosting, Deployment (Next.js)</td><td>Primär EU, ggf. USA</td><td><span className="badge warning">USA möglich</span></td></tr>
                <tr><td><strong>Stripe, Inc.</strong></td><td>Zahlungsabwicklung</td><td>USA / EU</td><td><span className="badge warning">USA möglich</span></td></tr>
              </tbody>
            </table>
            <div className="highlight-box">
              <strong>Hinweis zu Drittlandtransfers (USA)</strong>
              Vercel und Stripe können Daten in die USA übermitteln. Beide sind im Rahmen des <strong>EU-U.S. Data Privacy Framework</strong> zertifiziert und setzen <strong>Standardvertragsklauseln (SCC)</strong> gemäß Art. 46 Abs. 2 lit. c DSGVO ein.
            </div>
            <p>Eine Weitergabe an Dritte außerhalb der genannten Auftragsverarbeiter findet <strong>nicht</strong> statt. Keine Datenweitergabe zu Werbezwecken.</p>
          </section>

          <section id="dse-5">
            <h2><span className="num">5</span> Cookies, Tracking &amp; Werbung</h2>
            <p>Glev verwendet <strong>keine</strong> Werbe-Cookies, kein Web-Tracking und keine Analyse-Tools. Es werden ausschließlich <strong>technisch notwendige Session-Tokens</strong> eingesetzt, die keine gesonderte Einwilligung erfordern (§ 25 Abs. 2 TTDSG).</p>
            <p>Es gibt <strong>keine Werbeanzeigen</strong> in der Glev App.</p>
          </section>

          <section id="dse-6">
            <h2><span className="num">6</span> Speicherdauer</h2>
            <table>
              <thead><tr><th>Datenkategorie</th><th>Speicherdauer</th></tr></thead>
              <tbody>
                <tr><td>Kontodaten (E-Mail)</td><td>Bis zur Kontolöschung</td></tr>
                <tr><td>Gesundheitsdaten (Glukose, Mahlzeiten, Symptome)</td><td>Bis zur Kontolöschung</td></tr>
                <tr><td>Zahlungsinformationen (Stripe)</td><td>Gemäß gesetzlicher Aufbewahrungspflicht (bis zu 10 Jahre)</td></tr>
                <tr><td>Technische Logdaten</td><td>Maximal 30 Tage (rollierend)</td></tr>
              </tbody>
            </table>
            <p>Nach Kontoschließung werden alle personenbezogenen Daten – außer gesetzlich vorgeschriebenen – innerhalb von <strong>30 Tagen</strong> gelöscht.</p>
          </section>

          <section id="dse-7">
            <h2><span className="num">7</span> Deine Rechte</h2>
            <div className="rights-grid">
              <div className="right-card"><strong>📋 Auskunft (Art. 15)</strong><p>Auskunft über alle gespeicherten Daten.</p></div>
              <div className="right-card"><strong>✏️ Berichtigung (Art. 16)</strong><p>Korrektur unrichtiger Daten.</p></div>
              <div className="right-card"><strong>🗑️ Löschung (Art. 17)</strong><p>Kontolöschung jederzeit in der App möglich.</p></div>
              <div className="right-card"><strong>⏸️ Einschränkung (Art. 18)</strong><p>Verarbeitung einschränken lassen.</p></div>
              <div className="right-card"><strong>📦 Datenportabilität (Art. 20)</strong><p>Export deiner Daten als JSON/CSV.</p></div>
              <div className="right-card"><strong>🚫 Widerspruch (Art. 21)</strong><p>Widerspruch gegen interessenbasierte Verarbeitung.</p></div>
              <div className="right-card"><strong>↩️ Einwilligungswiderruf</strong><p>Widerruf jederzeit durch Kontolöschung.</p></div>
              <div className="right-card"><strong>⚖️ Beschwerde (Art. 77)</strong><p>Beschwerde bei der zuständigen Datenschutzbehörde.</p></div>
            </div>
            <p style={{ marginTop: "1.25rem" }}>Anfragen beantworten wir gemäß Art. 12 DSGVO innerhalb eines Monats. Kontakt: <a href="mailto:info@glev.app">info@glev.app</a></p>
          </section>

          <section id="dse-8">
            <h2><span className="num">8</span> Datensicherheit</h2>
            <ul>
              <li><strong>Verschlüsselung:</strong> TLS/HTTPS für alle Übertragungen; Encryption at Rest (Supabase)</li>
              <li><strong>Passwörter</strong> werden ausschließlich als salted Hash gespeichert</li>
              <li><strong>Row-Level Security (RLS)</strong> verhindert unbefugten Datenzugriff</li>
              <li><strong>Minimales Datenprinzip:</strong> Nur technisch notwendige Zugriffe</li>
            </ul>
          </section>

          <section id="dse-9">
            <h2><span className="num">9</span> Minderjährige</h2>
            <p>Glev richtet sich an Personen ab 16 Jahren. Nutzer unter 16 Jahren dürfen die App nur mit Einwilligung eines Erziehungsberechtigten verwenden.</p>
          </section>

          <section id="dse-10">
            <h2><span className="num">10</span> Datenschutzbehörde &amp; Kontakt</h2>
            <div className="contact-block">
              <strong>Lucas Rolleke Pinto Wahnon</strong><br />
              E-Mail: <a href="mailto:info@glev.app">info@glev.app</a><br />
              Website: <a href="https://glev.app" target="_blank" rel="noopener">glev.app</a>
            </div>
            <p style={{ marginTop: "1rem" }}>Zuständige Datenschutzbehörde (Portugal): <strong>CNPD</strong>, <a href="https://www.cnpd.pt" target="_blank" rel="noopener">www.cnpd.pt</a>. Nutzer aus dem DACH-Raum können sich auch an die Behörde ihres Wohnsitzlandes wenden.</p>
          </section>

          <section id="dse-11">
            <h2><span className="num">11</span> Änderungen</h2>
            <p>Wir behalten uns vor, diese Datenschutzerklärung bei Bedarf anzupassen. Bei wesentlichen Änderungen werden registrierte Nutzer per E-Mail informiert. <strong>Stand: April 2026.</strong></p>
          </section>
        </div>
      </div>

      {/* ─── AGB ─────────────────────────────────────────────── */}
      <div
        className={`tab-panel ${tab === "agb" ? "active" : ""}`}
        id="panel-agb"
        role="tabpanel"
        aria-labelledby="tab-agb"
      >
        <div className="meta-strip">Stand: April 2026 &nbsp;·&nbsp; Gültig für glev.app</div>
        <div className="container">
          <div className="intro-box">
            Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für die Nutzung der Glev App und alle damit verbundenen Dienste. Bitte lies sie sorgfältig, bevor du ein Konto erstellst oder ein Abonnement abschließt.
          </div>

          <section id="agb-1">
            <h2><span className="num">1</span> Anbieter &amp; Vertragsgegenstand</h2>
            <p>Anbieter der Glev App ist:</p>
            <div className="contact-block">
              <strong>Lucas Rolleke Pinto Wahnon</strong><br />
              Einzelunternehmer (Freiberufler / Recibo Verde)<br />
              Lissabon, Portugal<br />
              E-Mail: <a href="mailto:info@glev.app">info@glev.app</a><br />
              Website: <a href="https://glev.app" target="_blank" rel="noopener">glev.app</a>
            </div>
            <p style={{ marginTop: "1rem" }}><strong>Glev</strong> ist eine digitale Companion App für Menschen mit Typ-1-Diabetes (T1D), die im DACH-Markt (Deutschland, Österreich, Schweiz) angeboten wird. Die App ermöglicht die Erfassung und Auswertung von Glukosewerten, Mahlzeiten und Symptomen sowie die optionale Verknüpfung mit CGM-Systemen.</p>
            <p>Der Vertrag kommt durch Abschluss der Registrierung und Bestätigung der AGB zustande.</p>
          </section>

          <section id="agb-2">
            <h2><span className="num">2</span> Leistungsumfang</h2>
            <p>Glev bietet folgende digitale Leistungen an:</p>
            <ul>
              <li>Erfassung und Visualisierung von Glukosewerten (manuell und/oder per CGM)</li>
              <li>Mahlzeitentracking (Makronährstoffe)</li>
              <li>Symptom- und Wohlbefindenstagebuch</li>
              <li>Auswertungen und Verlaufsgrafiken</li>
              <li>Optionale CGM-Integration</li>
            </ul>
            <p>Der Anbieter behält sich vor, den Leistungsumfang im Laufe der Zeit zu erweitern oder anzupassen. Wesentliche Einschränkungen bestehender Kernfunktionen werden den Nutzern vorab mitgeteilt.</p>
          </section>

          <section id="agb-3">
            <h2><span className="num">3</span> Preise &amp; Zahlungsbedingungen</h2>
            <p>Glev wird als Abonnementdienst angeboten. Die aktuellen Tarife sind:</p>

            <div className="price-grid">
              <div className="price-card featured">
                <div className="plan-name">Early Access</div>
                <div className="price">€ 19</div>
                <div className="price-sub">einmalig · begrenzt verfügbar</div>
                <p>Dauerhafter Zugang bis zur Einführung des regulären Abonnements (Juli 2026). Danach Übergang zu einem vergünstigten Tarif.</p>
              </div>
              <div className="price-card">
                <div className="plan-name">Free → Pro (ab Juli 2026)</div>
                <div className="price">€ 4,50</div>
                <div className="price-sub">pro Monat · Einführungspreis</div>
                <p>Regulärer Monatspreis ab Einführung des Pro-Abonnements.</p>
              </div>
              <div className="price-card">
                <div className="plan-name">Pro (Vollpreis)</div>
                <div className="price">€ 24,90</div>
                <div className="price-sub">pro Monat</div>
                <p>Regulärer Pro-Tarif ohne Einführungsrabatt.</p>
              </div>
            </div>

            <p>Alle Preise sind Endpreise in Euro inkl. gesetzlich anfallender Mehrwertsteuer (soweit anwendbar).</p>

            <h3>Zahlungsabwicklung</h3>
            <p>Die Zahlungsabwicklung erfolgt über <strong>Stripe, Inc.</strong> Die Abbuchung des Abonnements erfolgt im Voraus für den jeweiligen Abrechnungszeitraum. Akzeptierte Zahlungsmittel: Kredit-/Debitkarte, SEPA-Lastschrift (soweit verfügbar) und weitere von Stripe angebotene Methoden.</p>

            <h3>Preisänderungen</h3>
            <p>Der Anbieter behält sich vor, die Preise anzupassen. Preiserhöhungen werden bestehenden Nutzern mindestens <strong>30 Tage</strong> vor Inkrafttreten per E-Mail mitgeteilt. Nutzer haben in diesem Fall das Recht, ihr Abonnement vor Inkrafttreten der Preiserhöhung zu kündigen.</p>
          </section>

          <section id="agb-4">
            <h2><span className="num">4</span> Laufzeit &amp; Kündigung</h2>

            <h3>Monatliche Abonnements</h3>
            <p>Monatliche Abonnements verlängern sich automatisch um jeweils einen Monat, sofern sie nicht vor Ende der laufenden Abrechnungsperiode gekündigt werden. Die Kündigung ist jederzeit <strong>innerhalb der App unter Kontoeinstellungen</strong> möglich.</p>

            <h3>Kündigungsfrist</h3>
            <p>Die Kündigung wird zum Ende des aktuellen Abrechnungszeitraums wirksam. Eine Rückerstattung bereits bezahlter Zeiträume erfolgt nicht, es sei denn, ein gesetzlicher Anspruch (z. B. Widerrufsrecht, s. § 5) besteht.</p>

            <h3>Kündigung durch den Anbieter</h3>
            <p>Der Anbieter kann ein Konto bei schwerwiegendem Verstoß gegen diese AGB mit sofortiger Wirkung kündigen. In allen anderen Fällen gilt eine Frist von 30 Tagen. Bei Kündigung durch den Anbieter ohne wichtigen Grund wird der anteilige Betrag des verbleibenden Abrechnungszeitraums erstattet.</p>

            <h3>Kontolöschung</h3>
            <p>Mit Kontolöschung endet auch das Abonnement. Alle gespeicherten Daten werden gemäß der Datenschutzerklärung innerhalb von 30 Tagen gelöscht.</p>
          </section>

          <section id="agb-5">
            <h2><span className="num">5</span> Widerrufsrecht</h2>

            <div className="info-box">
              <strong>ℹ️ Widerrufsrecht für Verbraucher</strong>
              Als Verbraucher steht dir grundsätzlich ein gesetzliches Widerrufsrecht zu.
            </div>

            <h3>Widerrufsfrist</h3>
            <p>Du hast das Recht, diesen Vertrag binnen <strong>14 Tagen ohne Angabe von Gründen</strong> zu widerrufen. Die Widerrufsfrist beginnt mit dem Tag des Vertragsschlusses.</p>

            <h3>Ausübung des Widerrufs</h3>
            <p>Um das Widerrufsrecht auszuüben, sende eine eindeutige Erklärung (z. B. per E-Mail) an:</p>
            <div className="contact-block" style={{ marginBottom: "1rem" }}>
              <a href="mailto:info@glev.app">info@glev.app</a> &nbsp;–&nbsp; Betreff: „Widerruf Glev-Abonnement"
            </div>

            <h3>Erlöschen des Widerrufsrechts bei digitalen Inhalten</h3>
            <div className="highlight-box">
              <strong>⚠️ Wichtiger Hinweis (§ 356 Abs. 5 BGB)</strong>
              Das Widerrufsrecht erlischt vorzeitig, wenn die Vertragserfüllung (Zugang zur digitalen Leistung) begonnen hat und du vor Beginn der Ausführung ausdrücklich zugestimmt hast, dass der Anbieter vor Ablauf der Widerrufsfrist mit der Ausführung beginnt, und du deine Kenntnis davon bestätigt hast, dass dein Widerrufsrecht mit dem Beginn der Ausführung erlischt. Bei der Registrierung holst du diese Zustimmung aktiv ein.
            </div>

            <h3>Rückerstattung bei wirksamem Widerruf</h3>
            <p>Bei wirksamem Widerruf erstatten wir alle geleisteten Zahlungen unverzüglich, spätestens innerhalb von 14 Tagen nach Eingang des Widerrufs, über dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast.</p>
          </section>

          <section id="agb-6">
            <h2><span className="num">6</span> Kein medizinischer Rat – Haftungsausschluss</h2>

            <div className="highlight-box">
              <strong>⚠️ Wichtiger Hinweis: Keine medizinische Beratung</strong>
              Glev ist eine <strong>Lifestyle- und Tracking-App</strong> und kein Medizinprodukt im Sinne der EU-Medizinprodukteverordnung (MDR 2017/745). Die App ersetzt <strong>keinen Arzt, kein medizinisches Fachpersonal und keine medizinische Behandlung</strong>.
            </div>

            <p>Alle in der App angezeigten Informationen, Auswertungen und Empfehlungen dienen ausschließlich zur persönlichen Orientierung und Information. Sie stellen keine Diagnose, keine medizinische Empfehlung und keine Therapieanweisung dar.</p>
            <p>Entscheidungen über Insulindosierungen, Behandlungsänderungen oder sonstige medizinische Maßnahmen müssen stets in Absprache mit qualifiziertem medizinischen Fachpersonal getroffen werden.</p>

            <h3>Haftungsbeschränkung</h3>
            <p>Der Anbieter haftet für Schäden, die durch einfache Fahrlässigkeit verursacht wurden, nur bei Verletzung wesentlicher Vertragspflichten (Kardinalpflichten) und nur in Höhe des typischerweise vorhersehbaren Schadens. Die Haftung für Vorsatz und grobe Fahrlässigkeit sowie für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit bleibt unberührt.</p>
            <p>Eine Haftung für medizinische Entscheidungen, die auf Grundlage von App-Inhalten getroffen werden, ist ausdrücklich ausgeschlossen.</p>

            <h3>Verfügbarkeit</h3>
            <p>Der Anbieter bemüht sich um eine möglichst hohe Verfügbarkeit der App, übernimmt jedoch keine Garantie für eine ununterbrochene Verfügbarkeit. Wartungsarbeiten und notwendige Unterbrechungen werden nach Möglichkeit vorab angekündigt.</p>
          </section>

          <section id="agb-7">
            <h2><span className="num">7</span> Nutzerpflichten</h2>
            <p>Du verpflichtest dich, bei der Nutzung von Glev:</p>
            <ul>
              <li>Zutreffende und vollständige Registrierungsdaten anzugeben</li>
              <li>Zugangsdaten sicher aufzubewahren und nicht an Dritte weiterzugeben</li>
              <li>Die App nicht missbräuchlich, rechtswidrig oder zum Schaden Dritter zu nutzen</li>
              <li>Keine automatisierten Zugriffe, Scraping oder Reverse Engineering durchzuführen</li>
            </ul>
          </section>

          <section id="agb-8">
            <h2><span className="num">8</span> Geistiges Eigentum</h2>
            <p>Alle Rechte an der Glev App – einschließlich Design, Code, Marke und Inhalte – liegen beim Anbieter oder seinen Lizenzgebern. Die Nutzung der App begründet kein Eigentumsrecht des Nutzers an diesen Elementen.</p>
            <p>Deine eingegebenen Daten (Glukosewerte, Mahlzeiten, Symptome) bleiben dein Eigentum. Du kannst sie jederzeit exportieren und löschen.</p>
          </section>

          <section id="agb-9">
            <h2><span className="num">9</span> Anwendbares Recht &amp; Gerichtsstand</h2>
            <p>Es gilt das Recht der <strong>Bundesrepublik Deutschland</strong>, unter Ausschluss des UN-Kaufrechts (CISG). Zwingende Verbraucherschutzvorschriften des Wohnsitzstaates des Nutzers bleiben unberührt.</p>
            <p>Gerichtsstand für Streitigkeiten mit Kaufleuten oder juristischen Personen des öffentlichen Rechts ist <strong>Lissabon, Portugal</strong>. Für Verbraucher gilt der allgemeine gesetzliche Gerichtsstand.</p>

            <div className="info-box">
              <strong>ℹ️ Online-Streitbeilegung (OS-Plattform)</strong>
              Die EU-Kommission stellt eine Plattform zur Online-Streitbeilegung bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">ec.europa.eu/consumers/odr</a>. Wir sind nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
            </div>
          </section>

          <section id="agb-10">
            <h2><span className="num">10</span> Änderungen der AGB</h2>
            <p>Der Anbieter behält sich vor, diese AGB anzupassen. Änderungen werden registrierten Nutzern mindestens <strong>30 Tage vor Inkrafttreten</strong> per E-Mail mitgeteilt. Widersprichst du den geänderten AGB nicht innerhalb dieser Frist, gelten sie als akzeptiert. Auf dieses Widerspruchsrecht wird in der Änderungsmitteilung ausdrücklich hingewiesen.</p>
            <p><strong>Stand dieser AGB: April 2026</strong></p>
          </section>

          <section id="agb-11">
            <h2><span className="num">11</span> Schlussbestimmungen</h2>
            <p>Sollten einzelne Bestimmungen dieser AGB unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. An die Stelle der unwirksamen Regelung tritt die gesetzlich zulässige Regelung, die dem wirtschaftlichen Zweck der unwirksamen Bestimmung am nächsten kommt.</p>
          </section>
        </div>
      </div>

      <footer className="legal-footer">
        © 2026 Lucas Rolleke Pinto Wahnon · Glev App ·{" "}
        <a href="mailto:info@glev.app">info@glev.app</a>
        <span className="legal-footer-sep"> · </span>
        <Link href="/" className="legal-back-link">Zurück zur Startseite</Link>
      </footer>
    </div>
  );
}

/* All selectors are scoped under .glev-legal so that the page's light-theme
   compliance design does not leak into (or get overridden by) the app's
   global dark-theme styles in app/globals.css. */
const LEGAL_CSS = `
.glev-legal {
  --legal-accent: #4F6EF7;
  --legal-accent-light: #EEF1FE;
  --legal-text: #1a1a2e;
  --legal-text-muted: #555;
  --legal-border: #e2e6f0;
  --legal-bg: #ffffff;
  --legal-section-bg: #fafbff;
  background: var(--legal-bg);
  color: var(--legal-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.75;
  font-size: 16px;
  min-height: 100vh;
}
.glev-legal *, .glev-legal *::before, .glev-legal *::after {
  box-sizing: border-box;
}

.glev-legal .gl-header {
  background: var(--legal-accent);
  color: #fff;
  padding: 2.5rem 1.5rem 0;
  text-align: center;
}
.glev-legal .gl-header .app-name {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.8;
  margin-bottom: 0.4rem;
}
.glev-legal .gl-header h1 {
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: #fff;
  letter-spacing: -0.02em;
}

.glev-legal .tab-bar {
  display: flex;
  justify-content: center;
  gap: 0.25rem;
  padding: 0 1.5rem;
}
.glev-legal .tab-btn {
  background: rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.85);
  border: none;
  border-radius: 8px 8px 0 0;
  padding: 0.65rem 1.75rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  font-family: inherit;
}
.glev-legal .tab-btn:hover {
  background: rgba(255,255,255,0.25);
  color: #fff;
}
.glev-legal .tab-btn.active {
  background: var(--legal-bg);
  color: var(--legal-accent);
}

.glev-legal .tab-panel { display: none; }
.glev-legal .tab-panel.active { display: block; }

.glev-legal .meta-strip {
  font-size: 0.82rem;
  color: var(--legal-text-muted);
  text-align: right;
  padding: 0.6rem 1.5rem;
  border-bottom: 1px solid var(--legal-border);
  background: var(--legal-section-bg);
}

.glev-legal .container {
  max-width: 780px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
}

.glev-legal .intro-box {
  background: var(--legal-accent-light);
  border-left: 4px solid var(--legal-accent);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 2.5rem;
  font-size: 0.95rem;
  color: var(--legal-text);
}

.glev-legal section { margin-bottom: 2.5rem; }
.glev-legal section + section {
  border-top: 1px solid var(--legal-border);
  padding-top: 2.5rem;
}

.glev-legal h2 {
  color: var(--legal-accent);
  font-size: 1.2rem;
  font-weight: 700;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  letter-spacing: -0.01em;
}
.glev-legal h2 .num {
  background: var(--legal-accent);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.glev-legal h3 {
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--legal-text);
  margin-top: 1.2rem;
  margin-bottom: 0.4rem;
  letter-spacing: -0.01em;
}

.glev-legal p { margin-bottom: 0.85rem; color: var(--legal-text); }
.glev-legal p:last-child { margin-bottom: 0; }

.glev-legal ul {
  padding-left: 1.4rem;
  margin-bottom: 0.85rem;
  color: var(--legal-text);
}
.glev-legal ul li { margin-bottom: 0.35rem; }

.glev-legal table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  margin: 0.75rem 0;
}
.glev-legal th {
  background: var(--legal-accent);
  color: #fff;
  text-align: left;
  padding: 0.6rem 0.9rem;
  font-weight: 600;
}
.glev-legal th:first-child { border-radius: 6px 0 0 0; }
.glev-legal th:last-child  { border-radius: 0 6px 0 0; }
.glev-legal td {
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid var(--legal-border);
  vertical-align: top;
  color: var(--legal-text);
  background: var(--legal-bg);
}
.glev-legal tr:last-child td { border-bottom: none; }
.glev-legal tr:nth-child(even) td { background: var(--legal-section-bg); }

.glev-legal .badge {
  display: inline-block;
  background: var(--legal-accent-light);
  color: var(--legal-accent);
  border-radius: 20px;
  padding: 0.15rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}
.glev-legal .badge.warning {
  background: #FFF4E5;
  color: #B45309;
}

.glev-legal .highlight-box {
  background: #FFF4E5;
  border-left: 4px solid #F59E0B;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin: 1rem 0;
  font-size: 0.92rem;
  color: var(--legal-text);
}
.glev-legal .highlight-box strong {
  display: block;
  margin-bottom: 0.3rem;
  color: #92400E;
}

.glev-legal .info-box {
  background: var(--legal-accent-light);
  border-left: 4px solid var(--legal-accent);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin: 1rem 0;
  font-size: 0.92rem;
  color: var(--legal-text);
}
.glev-legal .info-box strong {
  display: block;
  margin-bottom: 0.3rem;
  color: var(--legal-accent);
}

.glev-legal .contact-block {
  background: var(--legal-section-bg);
  border: 1px solid var(--legal-border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem;
  line-height: 2;
  color: var(--legal-text);
}

.glev-legal a { color: var(--legal-accent); text-decoration: none; }
.glev-legal a:hover { text-decoration: underline; }

.glev-legal .rights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1rem;
  margin-top: 0.75rem;
}
.glev-legal .right-card {
  background: var(--legal-section-bg);
  border: 1px solid var(--legal-border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
}
.glev-legal .right-card strong {
  display: block;
  color: var(--legal-accent);
  margin-bottom: 0.3rem;
  font-size: 0.92rem;
}
.glev-legal .right-card p {
  font-size: 0.85rem;
  color: var(--legal-text-muted);
  margin: 0;
}

.glev-legal .price-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin: 1rem 0;
}
.glev-legal .price-card {
  border: 2px solid var(--legal-border);
  border-radius: 10px;
  padding: 1.2rem 1.25rem;
  text-align: center;
  background: var(--legal-bg);
}
.glev-legal .price-card.featured {
  border-color: var(--legal-accent);
  background: var(--legal-accent-light);
}
.glev-legal .price-card .plan-name {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--legal-text-muted);
  margin-bottom: 0.5rem;
}
.glev-legal .price-card.featured .plan-name { color: var(--legal-accent); }
.glev-legal .price-card .price {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--legal-text);
  line-height: 1.1;
}
.glev-legal .price-card .price-sub {
  font-size: 0.78rem;
  color: var(--legal-text-muted);
  margin-top: 0.25rem;
}
.glev-legal .price-card p {
  font-size: 0.82rem;
  color: var(--legal-text-muted);
  margin-top: 0.6rem;
  margin-bottom: 0;
}

.glev-legal .legal-footer {
  text-align: center;
  padding: 1.5rem;
  font-size: 0.82rem;
  color: var(--legal-text-muted);
  border-top: 1px solid var(--legal-border);
}
.glev-legal .legal-footer-sep { color: var(--legal-border); }
.glev-legal .legal-back-link { color: var(--legal-accent); }

@media (max-width: 600px) {
  .glev-legal .gl-header { padding: 2rem 1rem 0; }
  .glev-legal .tab-btn { padding: 0.55rem 1.1rem; font-size: 0.88rem; }
  .glev-legal .container { padding: 2rem 1rem 3rem; }
  .glev-legal table { font-size: 0.82rem; }
  .glev-legal th, .glev-legal td { padding: 0.5rem 0.6rem; }
}
`;
