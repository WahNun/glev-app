"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";

function EulaPageInner() {
  const locale = useLocale();
  const [forceEn, setForceEn] = useState<boolean | null>(null);
  const isEn = forceEn !== null ? forceEn : locale === "en";

  return (
    <div className="glev-legal">
      <style>{LEGAL_CSS}</style>

      <header className="gl-header">
        <div className="app-name">Glev · Legal</div>
        <h1>{isEn ? "End User License Agreement (EULA)" : "Endbenutzer-Lizenzvereinbarung (EULA)"}</h1>
        <div className="tab-bar">
          <button
            className={`tab-btn ${!isEn ? "active" : ""}`}
            onClick={() => setForceEn(false)}
            aria-pressed={!isEn}
          >
            Deutsch
          </button>
          <button
            className={`tab-btn ${isEn ? "active" : ""}`}
            onClick={() => setForceEn(true)}
            aria-pressed={isEn}
          >
            English
          </button>
        </div>
      </header>

      <div className="tab-panel active">
        <div className="meta-strip">
          {isEn
            ? "Effective: 22 June 2026 · Glev Plus — Auto-Renewable Subscription"
            : "Stand: 22. Juni 2026 · Glev Plus — Auto-Renewable Subscription"}
        </div>
        <div className="container">

          <div className="intro-box">
            {isEn ? (
              <>
                This End User License Agreement (&ldquo;Agreement&rdquo;) is a legal agreement between you and
                Lucas Wahnon (trading as &ldquo;Glev&rdquo;, &ldquo;Licensor&rdquo;). By downloading,
                installing, or using the Glev App you agree to be bound by the terms of this Agreement.
                Apple Inc. is not a party to this Agreement and is not responsible for the App or its content.
              </>
            ) : (
              <>
                Diese Endbenutzer-Lizenzvereinbarung (&bdquo;Vereinbarung&ldquo;) ist ein rechtlicher
                Vertrag zwischen dir und Lucas Wahnon (handelnd unter &bdquo;Glev&ldquo;,
                &bdquo;Lizenzgeber&ldquo;). Mit dem Herunterladen, Installieren oder Nutzen der Glev App
                stimmst du den Bedingungen dieser Vereinbarung zu. Apple Inc. ist kein Vertragspartner
                dieser Vereinbarung und nicht verantwortlich für die App oder deren Inhalt.
              </>
            )}
          </div>

          {/* § 1 */}
          <section id="eula-1">
            <h2>
              <span className="num">1</span>
              {isEn ? "Acknowledgment" : "Anerkennung"}
            </h2>
            {isEn ? (
              <>
                <p>
                  Glev is licensed to you, not sold. The Licensor retains all intellectual property rights,
                  title, and interest in and to the App. This Agreement is concluded solely between you and
                  the Licensor — <strong>not with Apple Inc.</strong>
                </p>
                <p>
                  Apple Inc. is not responsible for the App and its content. You acknowledge that Apple has
                  no obligation whatsoever to furnish any maintenance or support services with respect to
                  the App.
                </p>
                <div className="contact-block">
                  <strong>Licensor</strong><br />
                  Lucas Wahnon (trading as Glev)<br />
                  Rua Frei Amador Arrais 13, 1700-202 Lisbon, Portugal<br />
                  E-Mail: <a href="mailto:info@glev.app">info@glev.app</a>
                </div>
              </>
            ) : (
              <>
                <p>
                  Glev wird dir lizenziert, nicht verkauft. Der Lizenzgeber behält alle geistigen
                  Eigentumsrechte, Titel und Interessen an und für die App. Diese Vereinbarung wird
                  ausschließlich zwischen dir und dem Lizenzgeber abgeschlossen —&nbsp;
                  <strong>nicht mit Apple Inc.</strong>
                </p>
                <p>
                  Apple Inc. ist nicht verantwortlich für die App und deren Inhalt. Du erkennst an, dass
                  Apple keinerlei Verpflichtung hat, Wartungs- oder Supportleistungen für die App zu
                  erbringen.
                </p>
                <div className="contact-block">
                  <strong>Lizenzgeber</strong><br />
                  Lucas Wahnon (handelnd als Glev)<br />
                  Rua Frei Amador Arrais 13, 1700-202 Lissabon, Portugal<br />
                  E-Mail: <a href="mailto:info@glev.app">info@glev.app</a>
                </div>
              </>
            )}
          </section>

          {/* § 2 */}
          <section id="eula-2">
            <h2>
              <span className="num">2</span>
              {isEn ? "Scope of License" : "Umfang der Lizenz"}
            </h2>
            {isEn ? (
              <>
                <p>
                  Subject to your compliance with this Agreement and payment of the applicable
                  subscription fees, the Licensor grants you a <strong>non-exclusive,
                  non-transferable, revocable license</strong> to:
                </p>
                <ul>
                  <li>Download and install the App on Apple-branded devices that you own or control.</li>
                  <li>Use the App solely for your personal, non-commercial purposes.</li>
                </ul>
                <p>You may <strong>not</strong>:</p>
                <ul>
                  <li>Copy, modify, or create derivative works of the App.</li>
                  <li>Redistribute, sublicense, rent, lease, or sell the App or access to it.</li>
                  <li>Reverse-engineer, decompile, or disassemble the App.</li>
                  <li>Remove or alter any proprietary notices or labels on the App.</li>
                </ul>
              </>
            ) : (
              <>
                <p>
                  Vorbehaltlich der Einhaltung dieser Vereinbarung und der Zahlung der anfallenden
                  Abonnementgebühren gewährt dir der Lizenzgeber eine <strong>nicht-exklusive,
                  nicht-übertragbare, widerrufliche Lizenz</strong> zur:
                </p>
                <ul>
                  <li>
                    Installation und Nutzung der App auf Apple-Geräten, die in deinem Eigentum stehen
                    oder von dir kontrolliert werden.
                  </li>
                  <li>Nutzung der App ausschließlich für persönliche, nicht-kommerzielle Zwecke.</li>
                </ul>
                <p>Folgendes ist <strong>nicht</strong> gestattet:</p>
                <ul>
                  <li>Kopieren, Modifizieren oder Erstellen abgeleiteter Werke der App.</li>
                  <li>Weitervertreiben, Unterlizenzieren, Vermieten, Verpachten oder Verkaufen der App.</li>
                  <li>Reverse Engineering, Dekompilierung oder Disassemblierung der App.</li>
                  <li>Entfernen oder Ändern von Eigentumsvermerken oder Kennzeichnungen in der App.</li>
                </ul>
              </>
            )}
          </section>

          {/* § 3 */}
          <section id="eula-3">
            <h2>
              <span className="num">3</span>
              {isEn ? "Consent to Use of Data" : "Datennutzung und Einwilligung"}
            </h2>
            {isEn ? (
              <>
                <p>
                  You agree that the Licensor may collect and use the following data to provide and
                  improve the App&apos;s features and services:
                </p>
                <ul>
                  <li><strong>Meals and macronutrients</strong> (manually entered or via voice/photo)</li>
                  <li><strong>CGM glucose readings</strong> (if you activate a CGM integration)</li>
                  <li>
                    <strong>Voice recordings</strong> (temporary; deleted immediately after transcription
                    by Mistral Voxtral — not stored permanently)
                  </li>
                  <li>
                    <strong>Photo uploads</strong> (temporary; used solely for meal recognition — not
                    stored permanently)
                  </li>
                </ul>
                <p>
                  This data may be transmitted to <strong>Mistral AI SAS</strong> (EU, France) for AI
                  processing solely to deliver the requested App feature. Mistral does not store this data
                  permanently and does not use it for training purposes (API mode, opt-out active).
                </p>
                <p>
                  All account and health data is stored on <strong>Supabase servers in the EU (Ireland)</strong>.
                  For full details on data processing, legal bases, and your rights, please refer to our
                  Privacy Policy at{" "}
                  <Link href="/legal">glev.app/legal</Link>.
                </p>
              </>
            ) : (
              <>
                <p>
                  Du stimmst zu, dass der Lizenzgeber folgende Daten erheben und nutzen darf, um die
                  Funktionen und Dienste der App bereitzustellen und zu verbessern:
                </p>
                <ul>
                  <li>
                    <strong>Mahlzeiten und Makronährstoffe</strong> (manuell eingegeben oder per
                    Sprach-/Foto-Eingabe)
                  </li>
                  <li>
                    <strong>CGM-Glukosewerte</strong> (sofern du eine CGM-Integration aktivierst)
                  </li>
                  <li>
                    <strong>Sprach-Aufnahmen</strong> (temporär; werden unverzüglich nach der
                    Transkription durch Mistral Voxtral gelöscht — keine dauerhafte Speicherung)
                  </li>
                  <li>
                    <strong>Foto-Uploads</strong> (temporär; werden ausschließlich für die
                    Mahlzeiten-Erkennung verwendet — keine dauerhafte Speicherung)
                  </li>
                </ul>
                <p>
                  Diese Daten können zur KI-Verarbeitung an <strong>Mistral AI SAS</strong> (EU,
                  Frankreich) übertragen werden, ausschließlich zur Erbringung der angefragten
                  App-Funktion. Mistral speichert diese Daten nicht dauerhaft und verwendet sie nicht
                  zu Trainingszwecken (API-Modus, opt-out aktiv).
                </p>
                <p>
                  Alle Konto- und Gesundheitsdaten werden auf <strong>Supabase-Servern in der EU
                  (Irland)</strong> gespeichert. Vollständige Informationen zu Datenverarbeitung,
                  Rechtsgrundlagen und deinen Rechten findest du in unserer Datenschutzerklärung unter{" "}
                  <Link href="/legal">glev.app/legal</Link>.
                </p>
              </>
            )}
          </section>

          {/* § 4 */}
          <section id="eula-4">
            <h2>
              <span className="num">4</span>
              {isEn ? "Termination" : "Kündigung und Beendigung"}
            </h2>
            {isEn ? (
              <>
                <p>
                  This license is effective for as long as you maintain an active Glev Plus subscription.
                  The license terminates automatically and without notice if you:
                </p>
                <ul>
                  <li>Cancel your Glev Plus subscription;</li>
                  <li>Delete your Glev account; or</li>
                  <li>Breach any term of this Agreement.</li>
                </ul>
                <p>
                  Upon termination, you must cease all use of the App and destroy all copies in your
                  possession. The Licensor may also terminate this Agreement at any time for cause with
                  immediate effect. Upon termination without cause by the Licensor, any prepaid
                  subscription fees for the remaining billing period will be refunded on a pro-rata basis.
                </p>
              </>
            ) : (
              <>
                <p>
                  Diese Lizenz gilt so lange, wie du ein aktives Glev Plus-Abonnement unterhältst. Die
                  Lizenz endet automatisch und ohne Ankündigung, wenn du:
                </p>
                <ul>
                  <li>dein Glev Plus-Abonnement kündigst;</li>
                  <li>dein Glev-Konto löschst; oder</li>
                  <li>eine Bestimmung dieser Vereinbarung verletzt.</li>
                </ul>
                <p>
                  Bei Beendigung musst du die Nutzung der App einstellen und alle in deinem Besitz
                  befindlichen Kopien vernichten. Der Lizenzgeber kann diese Vereinbarung außerdem
                  jederzeit aus wichtigem Grund mit sofortiger Wirkung kündigen. Bei Kündigung ohne
                  wichtigen Grund durch den Lizenzgeber werden bereits gezahlte Abonnementgebühren für
                  den verbleibenden Abrechnungszeitraum anteilig erstattet.
                </p>
              </>
            )}
          </section>

          {/* § 5 */}
          <section id="eula-5">
            <h2>
              <span className="num">5</span>
              {isEn ? "Services and Third-Party Materials" : "Dienste und Drittanbieter-Materialien"}
            </h2>
            {isEn ? (
              <>
                <p>
                  The App uses the following third-party services to deliver its features. Each provider
                  operates under its own terms of service and privacy policy:
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Purpose</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Mistral AI SAS</strong></td>
                      <td>AI language model (chat, STT/TTS, meal parsing, photo analysis)</td>
                      <td>EU (France)</td>
                    </tr>
                    <tr>
                      <td><strong>Supabase, Inc.</strong></td>
                      <td>Database and authentication</td>
                      <td>EU (Ireland)</td>
                    </tr>
                    <tr>
                      <td><strong>Vercel, Inc.</strong></td>
                      <td>Hosting and deployment</td>
                      <td>Primarily EU</td>
                    </tr>
                    <tr>
                      <td><strong>Stripe, Inc.</strong></td>
                      <td>Payment processing</td>
                      <td>USA / EU</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  The App may contain links to or incorporate materials from third parties. The Licensor
                  is not responsible for examining or evaluating such third-party content, and assumes no
                  liability for the services, products, or conduct of any third-party providers.
                </p>
              </>
            ) : (
              <>
                <p>
                  Die App nutzt folgende Drittanbieter-Dienste, um ihre Funktionen bereitzustellen. Jeder
                  Anbieter unterliegt seinen eigenen Nutzungsbedingungen und Datenschutzrichtlinien:
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Anbieter</th>
                      <th>Zweck</th>
                      <th>Standort</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Mistral AI SAS</strong></td>
                      <td>KI-Sprachmodell (Chat, Sprach-Erkennung/TTS, Mahlzeiten-Parsing, Foto-Analyse)</td>
                      <td>EU (Frankreich)</td>
                    </tr>
                    <tr>
                      <td><strong>Supabase, Inc.</strong></td>
                      <td>Datenbank und Authentifizierung</td>
                      <td>EU (Irland)</td>
                    </tr>
                    <tr>
                      <td><strong>Vercel, Inc.</strong></td>
                      <td>Hosting und Deployment</td>
                      <td>Primär EU</td>
                    </tr>
                    <tr>
                      <td><strong>Stripe, Inc.</strong></td>
                      <td>Zahlungsabwicklung</td>
                      <td>USA / EU</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  Die App kann Verlinkungen zu oder Materialien von Drittanbietern enthalten. Der
                  Lizenzgeber übernimmt keine Verantwortung für die Prüfung solcher Drittanbieter-Inhalte
                  und haftet nicht für Dienste, Produkte oder Verhaltensweisen von Drittanbietern.
                </p>
              </>
            )}
          </section>

          {/* § 6 */}
          <section id="eula-6">
            <h2>
              <span className="num">6</span>
              {isEn ? "No Warranty" : "Kein Gewährleistungsanspruch"}
            </h2>
            {isEn ? (
              <>
                <div className="highlight-box">
                  <strong>Important: Glev is not a medical device</strong>
                  Glev is a lifestyle and tracking app. It does not replace a doctor, medical professional,
                  or medical treatment, and does not provide medical diagnoses or therapeutic recommendations.
                </div>
                <p>
                  To the maximum extent permitted by applicable law, the App is provided <strong>&ldquo;as
                  is&rdquo;</strong> and <strong>&ldquo;as available&rdquo;</strong> without warranty of any
                  kind. The Licensor expressly disclaims all warranties, whether express, implied, statutory,
                  or otherwise, including, without limitation, any implied warranties of merchantability,
                  fitness for a particular purpose, and non-infringement.
                </p>
                <p>
                  The Licensor does not warrant that the App will be error-free, uninterrupted, or that
                  defects will be corrected. The Licensor does not warrant that the App is free of viruses
                  or other harmful components.
                </p>
              </>
            ) : (
              <>
                <div className="highlight-box">
                  <strong>Wichtig: Glev ist kein Medizinprodukt</strong>
                  Glev ist eine Lifestyle- und Tracking-App. Die App ersetzt keinen Arzt, kein medizinisches
                  Fachpersonal und keine medizinische Behandlung und gibt keine medizinischen Diagnosen oder
                  Therapieempfehlungen ab.
                </div>
                <p>
                  Soweit nach geltendem Recht maximal zulässig, wird die App <strong>„wie besehen"</strong>{" "}
                  und <strong>„wie verfügbar"</strong> ohne jegliche Gewährleistung bereitgestellt. Der
                  Lizenzgeber schließt ausdrücklich alle Gewährleistungen aus, ob ausdrücklich, stillschweigend,
                  gesetzlich oder anderweitig, einschließlich, aber nicht beschränkt auf stillschweigende
                  Gewährleistungen der Marktgängigkeit, Eignung für einen bestimmten Zweck und
                  Nichtverletzung von Rechten Dritter.
                </p>
                <p>
                  Der Lizenzgeber gewährleistet nicht, dass die App fehlerfrei, ununterbrochen verfügbar
                  ist oder dass Mängel behoben werden. Der Lizenzgeber gewährleistet nicht, dass die App
                  frei von Viren oder anderen schädlichen Komponenten ist.
                </p>
              </>
            )}
          </section>

          {/* § 7 */}
          <section id="eula-7">
            <h2>
              <span className="num">7</span>
              {isEn ? "Limitation of Liability" : "Haftungsbeschränkung"}
            </h2>
            {isEn ? (
              <>
                <p>
                  To the extent permitted by applicable law, in no event shall the Licensor be liable for
                  any indirect, incidental, special, exemplary, or consequential damages (including, but
                  not limited to, loss of data, loss of profit, or business interruption) arising out of
                  or in connection with the use or inability to use the App, even if advised of the
                  possibility of such damages.
                </p>
                <p>
                  The Licensor&apos;s total cumulative liability to you for all claims arising out of or
                  relating to this Agreement or the App shall not exceed the amount you paid to the
                  Licensor in the <strong>twelve (12) months</strong> preceding the claim.
                </p>
                <p>
                  Nothing in this Agreement limits liability for death or personal injury caused by
                  negligence, fraud, or any other liability that cannot be excluded or limited under
                  applicable law.
                </p>
              </>
            ) : (
              <>
                <p>
                  Soweit nach geltendem Recht zulässig, haftet der Lizenzgeber in keinem Fall für
                  mittelbare, zufällige, besondere, exemplarische oder Folgeschäden (einschließlich,
                  aber nicht beschränkt auf Datenverlust, entgangenen Gewinn oder
                  Betriebsunterbrechungen), die aus oder im Zusammenhang mit der Nutzung oder der
                  Unmöglichkeit der Nutzung der App entstehen, selbst wenn auf die Möglichkeit solcher
                  Schäden hingewiesen wurde.
                </p>
                <p>
                  Die Gesamthaftung des Lizenzgebers gegenüber dir für alle Ansprüche aus oder im
                  Zusammenhang mit dieser Vereinbarung oder der App ist auf den Betrag begrenzt, den du
                  dem Lizenzgeber in den <strong>zwölf (12) Monaten</strong> vor dem Anspruch gezahlt hast.
                </p>
                <p>
                  Nichts in dieser Vereinbarung schränkt die Haftung für Tod oder Körperverletzung durch
                  Fahrlässigkeit, Betrug oder sonstige Haftungen ein, die nach geltendem Recht nicht
                  ausgeschlossen oder begrenzt werden können.
                </p>
              </>
            )}
          </section>

          {/* § 8 */}
          <section id="eula-8">
            <h2>
              <span className="num">8</span>
              {isEn ? "Export Use" : "Exportkontrolle"}
            </h2>
            {isEn ? (
              <p>
                You may not use the App in any country or territory subject to a U.S. Government embargo,
                or for any individual or entity on a U.S. Government prohibited or restricted parties list.
                By using the App, you represent and warrant that you are not located in such a country or
                territory and are not on any such list.
              </p>
            ) : (
              <p>
                Du darfst die App nicht in Ländern oder Gebieten nutzen, die einem Embargo der US-Regierung
                unterliegen, und nicht für Personen oder Unternehmen, die auf einer Liste verbotener oder
                eingeschränkter Parteien der US-Regierung stehen. Mit der Nutzung der App sicherst du zu,
                dass du dich nicht in einem solchen Land oder Gebiet befindest und nicht auf einer solchen
                Liste stehst.
              </p>
            )}
          </section>

          {/* § 9 */}
          <section id="eula-9">
            <h2>
              <span className="num">9</span>
              {isEn ? "Apple as Third-Party Beneficiary" : "Apple als Drittbegünstigter"}
            </h2>
            {isEn ? (
              <>
                <p>
                  You acknowledge and agree that Apple Inc. and its subsidiaries are{" "}
                  <strong>third-party beneficiaries</strong> of this Agreement, and that, upon your
                  acceptance of the terms and conditions of this Agreement, Apple will have the right
                  (and will be deemed to have accepted the right) to enforce this Agreement against you
                  as a third-party beneficiary thereof.
                </p>
                <p>
                  In the event of any failure of the App to conform to any applicable warranty, you may
                  notify Apple, and Apple will refund the purchase price for the App to you. To the
                  maximum extent permitted by applicable law, Apple will have no other warranty obligation
                  whatsoever with respect to the App.
                </p>
                <p>
                  Apple is not responsible for addressing any claims by you or any third party relating
                  to the App or your possession and/or use of the App, including: (i) product liability
                  claims; (ii) any claim that the App fails to conform to any applicable legal or
                  regulatory requirement; and (iii) claims arising under consumer protection, privacy, or
                  similar legislation.
                </p>
              </>
            ) : (
              <>
                <p>
                  Du erkennst an und stimmst zu, dass Apple Inc. und ihre Tochtergesellschaften{" "}
                  <strong>Drittbegünstigte</strong> dieser Vereinbarung sind und dass Apple mit deiner
                  Annahme der Bedingungen dieser Vereinbarung das Recht hat (und als berechtigt gilt),
                  diese Vereinbarung dir gegenüber als Drittbegünstigter direkt durchzusetzen.
                </p>
                <p>
                  Entspricht die App einer anwendbaren Gewährleistung nicht, kannst du Apple benachrichtigen,
                  und Apple erstattet dir den Kaufpreis für die App. Soweit nach geltendem Recht maximal
                  zulässig, hat Apple darüber hinaus keine weitere Gewährleistungsverpflichtung bezüglich
                  der App.
                </p>
                <p>
                  Apple ist nicht verantwortlich für die Bearbeitung von Ansprüchen von dir oder Dritten
                  in Bezug auf die App oder dein Besitz und/oder deine Nutzung der App, einschließlich:
                  (i) Produkthaftungsansprüche; (ii) Ansprüche, dass die App eine anwendbare gesetzliche
                  oder behördliche Anforderung nicht erfüllt; und (iii) Ansprüche aus dem
                  Verbraucherschutz-, Datenschutz- oder ähnlichem Recht.
                </p>
              </>
            )}
          </section>

          {/* § 10 */}
          <section id="eula-10">
            <h2>
              <span className="num">10</span>
              {isEn ? "Governing Law" : "Anwendbares Recht und Gerichtsstand"}
            </h2>
            {isEn ? (
              <>
                <p>
                  This Agreement is governed by and construed in accordance with the laws of the{" "}
                  <strong>Federal Republic of Germany</strong>, excluding the UN Convention on Contracts
                  for the International Sale of Goods (CISG). Mandatory consumer protection provisions
                  of the user&apos;s country of residence remain unaffected.
                </p>
                <p>
                  The place of jurisdiction for all disputes arising from or in connection with this
                  Agreement is <strong>Munich, Germany</strong>, insofar as permitted by applicable law.
                  For consumers, the statutory place of jurisdiction applies.
                </p>
                <div className="info-box">
                  <strong>Online Dispute Resolution (ODR)</strong>
                  The European Commission provides a platform for online dispute resolution:{" "}
                  <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
                    ec.europa.eu/consumers/odr
                  </a>. The Licensor is not obliged and not willing to participate in dispute resolution
                  proceedings before a consumer arbitration board.
                </div>
              </>
            ) : (
              <>
                <p>
                  Diese Vereinbarung unterliegt dem Recht der{" "}
                  <strong>Bundesrepublik Deutschland</strong> unter Ausschluss des UN-Kaufrechts
                  (CISG). Zwingende Verbraucherschutzvorschriften des Wohnsitzstaates des Nutzers
                  bleiben unberührt.
                </p>
                <p>
                  Gerichtsstand für alle Streitigkeiten aus oder im Zusammenhang mit dieser Vereinbarung
                  ist <strong>München, Deutschland</strong>, soweit nach geltendem Recht zulässig.
                  Für Verbraucher gilt der allgemeine gesetzliche Gerichtsstand.
                </p>
                <div className="info-box">
                  <strong>Online-Streitbeilegung (OS-Plattform)</strong>
                  Die EU-Kommission stellt eine Plattform zur Online-Streitbeilegung bereit:{" "}
                  <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
                    ec.europa.eu/consumers/odr
                  </a>. Der Lizenzgeber ist nicht verpflichtet und nicht bereit, an einem
                  Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                </div>
              </>
            )}
          </section>

        </div>
      </div>

      <footer className="legal-footer">
        © 2026 Lucas Wahnon · Glev App ·{" "}
        <a href="mailto:info@glev.app">info@glev.app</a>
        <span className="legal-footer-sep"> · </span>
        <Link href="/legal" className="legal-back-link">
          {isEn ? "Privacy Policy & Terms" : "Datenschutz & AGB"}
        </Link>
        <span className="legal-footer-sep"> · </span>
        <Link href="/" className="legal-back-link">
          {isEn ? "Back to homepage" : "Zurück zur Startseite"}
        </Link>
      </footer>
    </div>
  );
}

export default function EulaPage() {
  return (
    <Suspense fallback={null}>
      <EulaPageInner />
    </Suspense>
  );
}

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
  margin-top: 1rem;
}

.glev-legal a { color: var(--legal-accent); text-decoration: none; }
.glev-legal a:hover { text-decoration: underline; }

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
