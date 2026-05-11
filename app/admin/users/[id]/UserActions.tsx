"use client";

import { useState } from "react";
import {
  setManualPlanAction,
  clearManualPlanAction,
  confirmEmailAction,
  disconnectCgmAction,
  softDeleteAction,
  restoreUserAction,
  hardDeleteAction,
  setRoleAction,
  sendMagicLinkAction,
} from "../actions";

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
  emailConfirmed,
  cgmConnected,
  deleted,
}: {
  userId: string;
  email: string;
  currentRole: string;
  currentManualPlan: string | null;
  currentManualPlanNote: string | null;
  emailConfirmed: boolean;
  cgmConnected: boolean;
  deleted: boolean;
}) {
  const [confirmKind, setConfirmKind] = useState<"soft" | "hard" | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");

  return (
    <>
      {/* --- Plan & Rolle --- */}
      <section style={section}>
        <h2 style={h2}>Plan & Rolle</h2>

        <form action={setManualPlanAction} style={row}>
          <input type="hidden" name="userId" value={userId} />
          <span style={lbl}>Manuellen Plan setzen:</span>
          <select name="plan" defaultValue={currentManualPlan ?? "pro"} style={input}>
            <option value="free">Free (entzieht Pro/Beta)</option>
            <option value="beta">Beta</option>
            <option value="pro">Pro</option>
          </select>
          <input
            name="note"
            type="text"
            placeholder={'Notiz (z.B. „Schwester, Lifetime Free")'}
            defaultValue={currentManualPlanNote ?? ""}
            style={{ ...input, flex: 1, minWidth: 240 }}
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

        <form action={sendMagicLinkAction} style={{ ...row, marginTop: 8 }}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="email" value={email} />
          <button type="submit" style={btnSecondary}>
            Magic-Link an {email || "User"} senden
          </button>
        </form>

        {cgmConnected ? (
          <form action={disconnectCgmAction} style={{ ...row, marginTop: 12 }}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnSecondary}>
              CGM-Verbindung trennen (LibreLinkUp/Nightscout/Apple Health)
            </button>
          </form>
        ) : null}
      </section>

      {/* --- Gefährliche Aktionen --- */}
      <section style={{ ...section, borderColor: "#fecaca" }}>
        <h2 style={{ ...h2, color: "#991b1b" }}>Gefährlich</h2>
        <p style={{ ...muted, margin: "0 0 12px" }}>
          Beide Lösch-Aktionen verlangen die vollständige E-Mail zur Bestätigung.
        </p>

        {!deleted ? (
          <button
            type="button"
            style={btnDanger}
            onClick={() => {
              setConfirmKind("soft");
              setConfirmEmail("");
            }}
          >
            Soft-Delete (Login sperren, Daten bleiben)
          </button>
        ) : (
          <form action={restoreUserAction} style={row}>
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" style={btnPrimary}>
              User wiederherstellen
            </button>
          </form>
        )}

        <button
          type="button"
          style={{ ...btnDanger, marginLeft: 8, background: "#7f1d1d" }}
          onClick={() => {
            setConfirmKind("hard");
            setConfirmEmail("");
          }}
        >
          Hard-Delete (alles weg, irreversibel)
        </button>
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
              {confirmKind === "soft" ? "Soft-Delete bestätigen" : "Hard-Delete bestätigen"}
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#444" }}>
              {confirmKind === "soft"
                ? 'Login wird gesperrt, Daten bleiben in der DB. Reversibel über „Wiederherstellen".'
                : "Der Account UND alle Mahlzeiten / Insulin / CGM-Credentials werden unwiderruflich gelöscht."}
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
              action={confirmKind === "soft" ? softDeleteAction : hardDeleteAction}
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
                {confirmKind === "soft" ? "Soft-Delete" : "Hard-Delete"} bestätigen
              </button>
            </form>
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
