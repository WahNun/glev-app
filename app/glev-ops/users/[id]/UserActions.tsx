"use client";

import { useState, useTransition } from "react";
import {
  setManualPlanAction,
  clearManualPlanAction,
  setGiftLabelAction,
  clearGiftLabelAction,
  setLanguageAction,
  confirmEmailAction,
  disconnectCgmAction,
  softDeleteAction,
  restoreUserAction,
  hardDeleteAction,
  cancelAndBanAction,
  setRoleAction,
  sendMagicLinkAction,
  sendPasswordResetAction,
} from "../actions";

function readAdminToken(): string {
  return (
    document.cookie
      .split(";")
      .find((c) => c.trim().startsWith("glev_ops_token="))
      ?.split("=")
      .slice(1)
      .join("=") ?? ""
  );
}

/**
 * All mutating actions for one user, grouped into three blocks
 * matching Stages 1-3 of the concept:
 *   - Plan & Status (manual override, clear, role)
 *   - Account (confirm email, magic-link, disconnect CGM)
 *   - Gefährlich (soft-delete / restore / hard-delete)
 *
 * Every destructive action sits behind a confirm modal that requires
 * typing the user's full email — same pattern across soft/hard delete
 * so muscle-memory doesn't trick you.
 */
export default function UserActions({
  userId,
  email,
  currentRole,
  currentManualPlan,
  currentManualPlanNote,
  currentGiftLabel,
  currentLanguage,
  emailConfirmed,
  cgmConnected,
  deleted,
  hasActiveStripeSub,
  phone,
  smsOptedOut,
}: {
  userId: string;
  email: string;
  currentRole: string;
  currentManualPlan: string | null;
  currentManualPlanNote: string | null;
  currentGiftLabel: string | null;
  currentLanguage: string | null;
  emailConfirmed: boolean;
  cgmConnected: boolean;
  deleted: boolean;
  hasActiveStripeSub: boolean;
  phone: string | null;
  smsOptedOut: boolean;
}) {
  const [confirmKind, setConfirmKind] = useState<"soft" | "hard" | "cancel_ban" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  // Bestätigungs-Dialog für Magic-Link & Passwort-Reset. Beide
  // schicken eine echte E-Mail an den User und sollten nicht aus
  // Versehen ausgelöst werden — gleiche UX wie der Drip-Send-Confirm.
  const [simpleConfirm, setSimpleConfirm] = useState<"magic" | "reset" | null>(null);
  const [pendingSimple, setPendingSimple] = useState<"magic" | "reset" | null>(null);
  const [simpleResult, setSimpleResult] = useState<{ ok: boolean; msg: string; kind?: "magic" | "reset" } | null>(null);
  const [, startTransition] = useTransition();

  // Push-Test
  const [pushPending, setPushPending] = useState(false);
  const [pushSandbox, setPushSandbox] = useState(true);
  const [pushResult, setPushResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // SMS Opt-Out-Relink
  const [relinkPending, setRelinkPending] = useState(false);
  const [relinkResult, setRelinkResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function sendRelink() {
    if (relinkPending) return;
    setRelinkPending(true);
    setRelinkResult(null);
    try {
      const tok = readAdminToken();
      const res = await fetch("/api/admin/sms-relink", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${tok}`,
        },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; to?: string; sid?: string };
      if (json.ok) {
        setRelinkResult({ ok: true, msg: `✅ Opt-Out-Link gesendet an ${json.to ?? "—"} (SID: ${json.sid ?? "?"})` });
      } else {
        setRelinkResult({ ok: false, msg: `❌ ${json.error ?? "Unbekannter Fehler"}` });
      }
    } catch (e) {
      setRelinkResult({ ok: false, msg: `❌ ${String(e)}` });
    } finally {
      setRelinkPending(false);
    }
  }

  async function sendTestPush() {
    if (pushPending) return;
    setPushPending(true);
    setPushResult(null);
    try {
      const token = document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("glev_admin_token="))
        ?.split("=")[1] ?? "";
      const res = await fetch("/api/admin/push-test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, sandbox: pushSandbox }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; platform?: string };
      if (json.ok) {
        setPushResult({ ok: true, msg: `✅ Gesendet (${json.platform ?? "?"})` });
      } else {
        setPushResult({ ok: false, msg: `❌ ${json.error ?? "Unbekannter Fehler"}` });
      }
    } catch (e) {
      setPushResult({ ok: false, msg: `❌ ${String(e)}` });
    } finally {
      setPushPending(false);
    }
  }

  function runSimpleAction(): void {
    const kind = simpleConfirm;
    if (!kind || pendingSimple) return;
    setPendingSimple(kind);
    setSimpleConfirm(null);
    setSimpleResult(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("userId", userId);
        fd.set("email", email);
        const result =
          kind === "magic"
            ? await sendMagicLinkAction(fd)
            : await sendPasswordResetAction(fd);
        if (result.ok) {
          setSimpleResult({
            ok: true,
            kind,
            msg:
              kind === "magic"
                ? `✅ Magic-Link an ${email} gesendet`
                : `✅ Passwort-Reset-Mail an ${email} gesendet`,
          });
        } else {
          setSimpleResult({ ok: false, msg: `❌ ${result.error}` });
        }
      } catch (e) {
        setSimpleResult({ ok: false, msg: `❌ ${String(e)}` });
      } finally {
        setPendingSimple(null);
      }
    });
  }

  return (
    <>
      {/* --- Plan & Rolle --- */}
      <section style={section}>
        <h2 style={h2}>Plan & Rolle</h2>

        <form action={setManualPlanAction} style={row}>
          <input type="hidden" name="userId" value={userId} />
          <span style={lbl}>Manuellen Plan setzen:</span>
          <select name="plan" defaultValue={currentManualPlan ?? "pro"} style={input}>
            <option value="free">⛔ Free — Zugang entziehen</option>
            <option value="beta">Smart S (Beta)</option>
            <option value="pro">Pro M</option>
            <option value="plus">Plus L</option>
          </select>
          <select name="durationDays" defaultValue="7" style={input}>
            <option value="0">∞ Kein Ablauf</option>
            <option value="7">7 Tage</option>
            <option value="14">14 Tage</option>
            <option value="30">30 Tage</option>
            <option value="90">3 Monate</option>
            <option value="365">1 Jahr</option>
          </select>
          <input
            name="note"
            type="text"
            placeholder={'Notiz (z.B. „Schwester, Lifetime Free")'}
            defaultValue={currentManualPlanNote ?? ""}
            style={{ ...input, flex: 1, minWidth: 200 }}
          />
          <button type="submit" style={btnPrimary}>
            Plan setzen
          </button>
        </form>

        {currentManualPlan ? (
          <form action={clearManualPlanAction} style={{ ...row, marginTop: 8 }}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnSecondary}>
              Manuellen Override entfernen (zurück zum Stripe-Status)
            </button>
          </form>
        ) : null}

        {/* Gift-Label — rein informativ, kein Einfluss auf computeEffectivePlan */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #eee" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>
            🎁 Geschenkter Zugang
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#666" }}>
            Nur zur Kennzeichnung — der eigentliche Plan muss oben via &quot;Manuellen Plan setzen&quot; vergeben werden.
          </p>
          <form action={setGiftLabelAction} style={row}>
            <input type="hidden" name="userId" value={userId} />
            <select name="label" defaultValue={currentGiftLabel ?? "Lifetime Access"} style={input}>
              <option value="Lifetime Access">Lifetime Access</option>
              <option value="1 Jahr kostenlos">1 Jahr kostenlos</option>
              <option value="6 Monate kostenlos">6 Monate kostenlos</option>
              <option value="3 Monate kostenlos">3 Monate kostenlos</option>
              <option value="Freundes-Zugang">Freundes-Zugang</option>
              <option value="Influencer">Influencer</option>
              <option value="Tester">Tester</option>
              <option value="Investor">Investor</option>
              <option value="Team">Team</option>
            </select>
            <button type="submit" style={btnPrimary}>
              Label setzen
            </button>
          </form>
          {currentGiftLabel ? (
            <div style={{ ...row, marginTop: 8, alignItems: "center" }}>
              <span
                style={{
                  background: "#fef9c3",
                  color: "#92400e",
                  border: "1px solid #fde68a",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                🎁 {currentGiftLabel}
              </span>
              <form action={clearGiftLabelAction} style={{ margin: 0 }}>
                <input type="hidden" name="userId" value={userId} />
                <button type="submit" style={{ ...btnSecondary, fontSize: 12, padding: "4px 10px" }}>
                  Label entfernen
                </button>
              </form>
            </div>
          ) : null}
        </div>

        <form action={setLanguageAction} style={{ ...row, marginTop: 16 }}>
          <input type="hidden" name="userId" value={userId} />
          <span style={lbl}>Sprache (UI):</span>
          <select name="language" defaultValue={currentLanguage ?? "de"} style={input}>
            <option value="de">Deutsch (de)</option>
            <option value="en">English (en)</option>
          </select>
          <button type="submit" style={btnPrimary}>
            Sprache setzen
          </button>
          <span style={{ ...muted, fontSize: 12 }}>
            Unabhängig von Currency — z.B. CHF-User auf Englisch ist ok.
          </span>
        </form>

        <form action={setRoleAction} style={{ ...row, marginTop: 16 }}>
          <input type="hidden" name="userId" value={userId} />
          <span style={lbl}>Rolle:</span>
          <select name="role" defaultValue={currentRole} style={input}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" style={btnPrimary}>
            Rolle setzen
          </button>
        </form>
      </section>

      {/* --- Account-Aktionen --- */}
      <section style={section}>
        <h2 style={h2}>Account</h2>

        {!emailConfirmed ? (
          <form action={confirmEmailAction} style={row}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnPrimary}>
              E-Mail manuell bestätigen
            </button>
          </form>
        ) : (
          <p style={{ ...muted, margin: "0 0 12px" }}>E-Mail ist bestätigt.</p>
        )}

        <div style={{ ...row, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setSimpleConfirm("magic")}
            disabled={pendingSimple === "magic" || simpleConfirm === "magic"}
            style={{
              ...btnSecondary,
              opacity: pendingSimple === "magic" || simpleConfirm === "magic" ? 0.6 : 1,
              cursor:
                pendingSimple === "magic" || simpleConfirm === "magic" ? "not-allowed" : "pointer",
            }}
          >
            {pendingSimple === "magic"
              ? "Sende…"
              : `Magic-Link an ${email || "User"} senden`}
          </button>
        </div>

        <div style={{ ...row, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setSimpleConfirm("reset")}
            disabled={pendingSimple === "reset" || simpleConfirm === "reset"}
            style={{
              ...btnSecondary,
              opacity: pendingSimple === "reset" || simpleConfirm === "reset" ? 0.6 : 1,
              cursor:
                pendingSimple === "reset" || simpleConfirm === "reset" ? "not-allowed" : "pointer",
            }}
          >
            {pendingSimple === "reset"
              ? "Sende…"
              : `Passwort-Reset-Mail an ${email || "User"} senden`}
          </button>
        </div>

        {simpleResult && (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: simpleResult.ok ? "#15803d" : "#991b1b" }}>
            {simpleResult.msg}
            {simpleResult.ok && simpleResult.kind === "reset" && (
              <a
                href="/glev-ops/emails?t=password-reset"
                style={{ marginLeft: 10, color: "#15803d", textDecoration: "underline" }}
              >
                Vorschau in Outbox →
              </a>
            )}
          </p>
        )}

        {cgmConnected ? (
          <form action={disconnectCgmAction} style={{ ...row, marginTop: 12 }}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnSecondary}>
              CGM-Verbindung trennen (LibreLinkUp/Nightscout/Apple Health)
            </button>
          </form>
        ) : null}
      </section>

      {/* --- Push-Test --- */}
      <section style={section}>
        <h2 style={h2}>Push-Benachrichtigung testen</h2>
        <p style={{ ...muted, margin: "0 0 12px" }}>
          Sendet eine Test-Push direkt ans Gerät. Funktioniert nur wenn der User die App geöffnet
          und Push-Berechtigung erteilt hat (Token in DB vorhanden).
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-dim)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={pushSandbox}
              onChange={(e) => setPushSandbox(e.target.checked)}
            />
            Sandbox (TestFlight) — deaktivieren für App Store
          </label>
          <button
            type="button"
            onClick={() => { void sendTestPush(); }}
            disabled={pushPending}
            style={{
              ...btnSecondary,
              opacity: pushPending ? 0.6 : 1,
              cursor: pushPending ? "not-allowed" : "pointer",
            }}
          >
            {pushPending ? "Sende…" : "🔔 Test-Push senden"}
          </button>
        </div>
        {pushResult && (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: pushResult.ok ? "#15803d" : "#991b1b" }}>
            {pushResult.msg}
          </p>
        )}
      </section>

      {/* --- SMS Opt-Out-Link erneut senden --- */}
      <section style={section}>
        <h2 style={h2}>SMS Opt-Out-Link</h2>
        <p style={{ ...muted, margin: "0 0 12px" }}>
          Sendet dem User eine frisch signierte Opt-Out-URL (aktueller{" "}
          <code>SMS_UNSUB_SECRET</code>). Sinnvoll nach einer Secret-Rotation,
          wenn der User eine veraltete Link-Version in seiner SMS-History hat.
          Die Aktion wird mit <code>event_type = &apos;relink&apos;</code> in{" "}
          <code>sms_optout_events</code> protokolliert.
        </p>
        <div style={{ ...row, marginBottom: 8 }}>
          <span style={lbl}>Telefon:</span>
          <code style={{ fontSize: 13 }}>{phone ?? "—"}</code>
          {smsOptedOut && (
            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                border: "1px solid #fde68a",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Bereits abgemeldet
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={relinkPending || !phone || smsOptedOut}
          onClick={() => { void sendRelink(); }}
          style={{
            ...btnSecondary,
            opacity: relinkPending || !phone || smsOptedOut ? 0.5 : 1,
            cursor: relinkPending || !phone || smsOptedOut ? "not-allowed" : "pointer",
          }}
          title={
            !phone
              ? "Keine Telefonnummer für diesen User"
              : smsOptedOut
                ? "User hat SMS bereits abbestellt"
                : "Frischen Opt-Out-Link per SMS senden"
          }
        >
          {relinkPending ? "Sende…" : "📩 Opt-Out-Link erneut senden"}
        </button>
        {relinkResult && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 13,
              color: relinkResult.ok ? "#15803d" : "#991b1b",
            }}
          >
            {relinkResult.msg}
          </p>
        )}
      </section>

      {/* --- Gefährliche Aktionen --- */}
      <section style={{ ...section, borderColor: "#fecaca" }}>
        <h2 style={{ ...h2, color: "#991b1b" }}>Gefährlich</h2>
        <p style={{ ...muted, margin: "0 0 12px" }}>
          Beide Lösch-Aktionen verlangen die vollständige E-Mail zur Bestätigung.
        </p>

        {!deleted ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              style={btnDanger}
              onClick={() => {
                setConfirmKind("cancel_ban");
                setConfirmEmail("");
              }}
            >
              {hasActiveStripeSub
                ? "Sperren & Abo kündigen (Stripe sofort)"
                : "Sperren (kein aktives Abo)"}
            </button>

            <button
              type="button"
              style={btnDanger}
              onClick={() => {
                setConfirmKind("soft");
                setConfirmEmail("");
              }}
            >
              Soft-Delete (Login sperren, Stripe unberührt)
            </button>

            <button
              type="button"
              style={{ ...btnDanger, background: "#7f1d1d" }}
              onClick={() => {
                setConfirmKind("hard");
                setConfirmEmail("");
              }}
            >
              Hard-Delete (alles weg, irreversibel)
            </button>
          </div>
        ) : (
          <form action={restoreUserAction} style={row}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnPrimary}>
              User wiederherstellen (entbannt — Stripe-Abo wird NICHT reaktiviert)
            </button>
          </form>
        )}

        <p style={{ ...muted, fontSize: 12, margin: "12px 0 0" }}>
          Hinweis: Aktive Login-Sessions können nach „Sperren" noch bis zu
          ~1h weiterleben (JWT-Restlaufzeit). Token-Refresh ist sofort
          blockiert, neuer Login auch — nur das aktuell ausgestellte
          Access-Token läuft erst regulär ab.
        </p>
      </section>

      {confirmKind ? (
        <div
          role="dialog"
          aria-modal="true"
          style={modalBackdrop}
          onClick={() => setConfirmKind(null)}
        >
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>
              {confirmKind === "soft"
                ? "Soft-Delete bestätigen"
                : confirmKind === "hard"
                  ? "Hard-Delete bestätigen"
                  : "Sperren & Abo kündigen bestätigen"}
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#444" }}>
              {confirmKind === "soft"
                ? 'Login wird gesperrt, Daten bleiben in der DB. Stripe-Abo läuft normal weiter. Reversibel über „Wiederherstellen".'
                : confirmKind === "hard"
                  ? "Der Account UND alle Mahlzeiten / Insulin / CGM-Credentials werden unwiderruflich gelöscht."
                  : hasActiveStripeSub
                    ? "Stripe-Subscription wird SOFORT gekündigt (kein period-end Grace) UND Login gesperrt. Reversibel — aber Stripe-Abo muss der User selbst neu abschließen."
                    : 'Kein aktives Stripe-Abo gefunden — nur Login wird gesperrt. Reversibel über „Wiederherstellen".'}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>
              Tippe zur Bestätigung die volle E-Mail des Users:
              <br />
              <code style={{ fontSize: 13 }}>{email}</code>
            </p>
            <input
              type="text"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              autoFocus
              placeholder="user@example.com"
              style={{ ...input, width: "100%", marginBottom: 12 }}
            />
            <form
              action={
                confirmKind === "soft"
                  ? softDeleteAction
                  : confirmKind === "hard"
                    ? hardDeleteAction
                    : cancelAndBanAction
              }
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="confirmEmail" value={confirmEmail} />
              <button
                type="button"
                style={btnSecondary}
                onClick={() => setConfirmKind(null)}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
                style={{
                  ...btnDanger,
                  opacity:
                    confirmEmail.trim().toLowerCase() === email.toLowerCase() ? 1 : 0.4,
                  cursor:
                    confirmEmail.trim().toLowerCase() === email.toLowerCase()
                      ? "pointer"
                      : "not-allowed",
                  background: confirmKind === "hard" ? "#7f1d1d" : "#b91c1c",
                }}
              >
                {confirmKind === "soft"
                  ? "Soft-Delete"
                  : confirmKind === "hard"
                    ? "Hard-Delete"
                    : "Sperren & Kündigen"}{" "}
                bestätigen
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Bestätigungs-Dialog für Magic-Link / Passwort-Reset.
          Klick auf Backdrop oder „Abbrechen" schließt ohne Aktion.
          „Ja, senden" feuert die Server-Action via useTransition. */}
      {simpleConfirm ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-confirm-title"
          style={modalBackdrop}
          onClick={() => setSimpleConfirm(null)}
        >
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h3 id="user-confirm-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
              E-Mail wirklich senden?
            </h3>
            <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>
              {simpleConfirm === "magic"
                ? "Magic-Link (Einmal-Login) an"
                : "Passwort-Reset-Link an"}{" "}
              <strong>{email}</strong>.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#666" }}>
              {simpleConfirm === "magic"
                ? "Der Link loggt den User direkt ein und ist nur einmal gültig."
                : "Der User erhält einen Link, mit dem er ein neues Passwort setzen kann."}{" "}
              Die Mail geht sofort raus und kann nicht mehr zurückgeholt werden.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => setSimpleConfirm(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                autoFocus
                onClick={runSimpleAction}
                style={{ ...btnPrimary, background: "#0a7a3b" }}
              >
                Ja, senden
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const section: React.CSSProperties = {
  marginBottom: 20,
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 16,
  background: "#fff",
};
const h2: React.CSSProperties = { fontSize: 16, margin: "0 0 12px" };
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const lbl: React.CSSProperties = { fontSize: 13, color: "#444", fontWeight: 600 };
const muted: React.CSSProperties = { fontSize: 13, color: "#666" };
const input: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  color: "#111",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const btnDanger: React.CSSProperties = {
  padding: "8px 14px",
  background: "#b91c1c",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 20,
};
const modalCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 480,
  boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
};
