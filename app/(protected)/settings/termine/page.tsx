"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeToBcp47 } from "@/lib/time";
import {
  fetchAppointments,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  APPOINTMENT_TAGS,
  tagColor,
  type Appointment,
} from "@/lib/appointments";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";
import UpgradeGate from "@/components/UpgradeGate";
import { usePlan } from "@/hooks/usePlan";

const ACCENT = "#4F6EF7", PINK = "#FF2D78", BORDER = "var(--border)";
const inp: React.CSSProperties = { background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%" };

export default function TermineSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const { canAccess } = usePlan();
  const uiLocale = useLocale();
  const bcp47 = localeToBcp47(uiLocale);
  const apptsTouchedRef = { current: false };

  const [open, setOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptEdits, setApptEdits] = useState<Record<string, { date: string; note: string; tags: string[]; a1c: string; egfr: string }>>({});
  const [newApptDate, setNewApptDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newApptNote, setNewApptNote] = useState<string>("");
  const [newApptTags, setNewApptTags] = useState<string[]>([]);
  const [newApptA1c, setNewApptA1c] = useState<string>("");
  const [newApptEgfr, setNewApptEgfr] = useState<string>("");
  const [apptBusy, setApptBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetchAppointments()
      .then((a) => { if (!apptsTouchedRef.current) setAppointments(a); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestAppointment = appointments[0] ?? null;
  const lastAppointmentSub = latestAppointment
    ? appointments.length > 1
      ? t("subtitle_appointments_many", {
          date: new Date(`${latestAppointment.appointmentAt}T00:00:00`).toLocaleDateString(bcp47, { year: "numeric", month: "2-digit", day: "2-digit" }),
          count: appointments.length,
        })
      : t("subtitle_last_appointment_set", {
          date: new Date(`${latestAppointment.appointmentAt}T00:00:00`).toLocaleDateString(bcp47, { year: "numeric", month: "2-digit", day: "2-digit" }),
        })
    : t("subtitle_last_appointment_unset");

  const openSheet = useCallback(() => {
    apptsTouchedRef.current = true;
    setApptEdits({});
    setNewApptDate(new Date().toISOString().slice(0, 10));
    setNewApptNote("");
    setNewApptTags([]);
    setNewApptA1c("");
    setNewApptEgfr("");
    setApptBusy(null);
    setSaveError("");
    setOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAppointmentAction = useCallback(async () => {
    if (!newApptDate) { setSaveError(t("appointments_date_required")); return; }
    setApptBusy("__add__");
    setSaveError("");
    try {
      const parsedA1c = newApptA1c !== "" ? parseFloat(newApptA1c) : null;
      const parsedEgfr = newApptEgfr !== "" ? parseFloat(newApptEgfr) : null;
      const inserted = await addAppointment(
        newApptDate, newApptNote, newApptTags,
        parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null,
        parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null,
      );
      setAppointments((prev) => [inserted, ...prev].sort((a, b) => b.appointmentAt.localeCompare(a.appointmentAt)));
      setNewApptDate(new Date().toISOString().slice(0, 10));
      setNewApptNote(""); setNewApptTags([]); setNewApptA1c(""); setNewApptEgfr("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed"));
    } finally { setApptBusy(null); }
  }, [newApptDate, newApptNote, newApptTags, newApptA1c, newApptEgfr, t]);

  const updateAppointmentAction = useCallback(async (id: string) => {
    const draft = apptEdits[id];
    if (!draft) return;
    if (!draft.date) { setSaveError(t("appointments_date_required")); return; }
    setApptBusy(id); setSaveError("");
    try {
      const parsedA1c = draft.a1c !== "" ? parseFloat(draft.a1c) : null;
      const parsedEgfr = draft.egfr !== "" ? parseFloat(draft.egfr) : null;
      await updateAppointment(id, draft.date, draft.note, draft.tags,
        parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null,
        parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null);
      setAppointments((prev) =>
        prev.map((a) => a.id === id ? { ...a, appointmentAt: draft.date, note: draft.note.trim() === "" ? null : draft.note.trim(), tags: draft.tags, a1c: parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null, egfr: parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null } : a)
          .sort((a, b) => b.appointmentAt.localeCompare(a.appointmentAt))
      );
      setApptEdits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed"));
    } finally { setApptBusy(null); }
  }, [apptEdits, t]);

  const deleteAppointmentAction = useCallback(async (id: string) => {
    if (!confirm(t("appointments_delete_confirm"))) return;
    setApptBusy(id); setSaveError("");
    try {
      await deleteAppointment(id);
      setAppointments((prev) => prev.filter((a) => a.id !== id));
      setApptEdits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed"));
    } finally { setApptBusy(null); }
  }, [t]);

  const closeFooter = (
    <button type="button" onClick={() => setOpen(false)} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
      {t("sheet_close")}
    </button>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_appointments")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...{ width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
          label={t("appointments_title")}
          subtitle={lastAppointmentSub}
          ariaLabel={t("row_open_aria", { label: t("appointments_title") })}
          onClick={canAccess("doctor_appointment_tracker") ? openSheet : () => {}}
          rightAdornment={<UpgradeGate feature="doctor_appointment_tracker" variant="row" />}
        />
      </SettingsSection>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("appointments_title")} footer={closeFooter}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{t("appointments_hint")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--surface-soft)", border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>{t("appointments_add_title")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input style={{ ...inp, flex: "1 1 140px", minWidth: 130 }} type="date" value={newApptDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setNewApptDate(e.target.value)} aria-label={t("appointments_date_label")} disabled={apptBusy !== null} />
              <input style={{ ...inp, flex: "2 1 180px" }} type="text" value={newApptNote} placeholder={t("appointments_note_placeholder")} onChange={(e) => setNewApptNote(e.target.value)} aria-label={t("appointments_note_label")} disabled={apptBusy !== null || !newApptDate} maxLength={200} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("appointments_tags_label")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {APPOINTMENT_TAGS.map((tag) => {
                  const selected = newApptTags.includes(tag);
                  const color = tagColor(tag);
                  const tagKey = `appointments_tag_${tag.toLowerCase()}` as Parameters<typeof t>[0];
                  return (
                    <button key={tag} type="button" disabled={apptBusy !== null} onClick={() => setNewApptTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1px solid ${selected ? color : BORDER}`, background: selected ? `${color}20` : "transparent", color: selected ? color : "var(--text-dim)", cursor: apptBusy !== null ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                      {t(tagKey)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("appointments_lab_values_title")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                  <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{t("appointments_a1c_label")}</label>
                  <input style={inp} type="number" min="2" max="20" step="0.1" value={newApptA1c} placeholder={t("appointments_a1c_placeholder")} onChange={(e) => setNewApptA1c(e.target.value)} disabled={apptBusy !== null} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                  <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{t("appointments_egfr_label")}</label>
                  <input style={inp} type="number" min="0" max="200" step="1" value={newApptEgfr} placeholder={t("appointments_egfr_placeholder")} onChange={(e) => setNewApptEgfr(e.target.value)} disabled={apptBusy !== null} />
                </div>
              </div>
            </div>
            <button type="button" onClick={addAppointmentAction} disabled={apptBusy !== null || !newApptDate} style={{ alignSelf: "flex-start", padding: "8px 16px", borderRadius: 9, border: "none", background: ACCENT, color: "var(--on-accent)", fontSize: 13, fontWeight: 700, cursor: apptBusy !== null || !newApptDate ? "not-allowed" : "pointer", opacity: apptBusy !== null || !newApptDate ? 0.6 : 1 }}>
              {apptBusy === "__add__" ? t("appointments_add_busy") : t("appointments_add_button")}
            </button>
          </div>

          {appointments.length === 0 ? (
            <div style={{ padding: "16px 14px", borderRadius: 12, border: `1px dashed ${BORDER}`, fontSize: 13, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.5 }}>{t("appointments_empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {appointments.map((appt) => {
                const editing = apptEdits[appt.id];
                const rowBusy = apptBusy === appt.id;
                const formatted = new Date(`${appt.appointmentAt}T00:00:00`).toLocaleDateString(bcp47, { year: "numeric", month: "2-digit", day: "2-digit" });
                return (
                  <div key={appt.id} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {editing ? (
                      <>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input style={{ ...inp, flex: "1 1 140px", minWidth: 130 }} type="date" value={editing.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setApptEdits((prev) => ({ ...prev, [appt.id]: { ...editing, date: e.target.value } }))} aria-label={t("appointments_date_label")} disabled={rowBusy} />
                          <input style={{ ...inp, flex: "2 1 180px" }} type="text" value={editing.note} placeholder={t("appointments_note_placeholder")} onChange={(e) => setApptEdits((prev) => ({ ...prev, [appt.id]: { ...editing, note: e.target.value } }))} aria-label={t("appointments_note_label")} disabled={rowBusy} maxLength={200} />
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {APPOINTMENT_TAGS.map((tag) => {
                            const selected = editing.tags.includes(tag);
                            const color = tagColor(tag);
                            const tagKey = `appointments_tag_${tag.toLowerCase()}` as Parameters<typeof t>[0];
                            return (
                              <button key={tag} type="button" disabled={rowBusy} onClick={() => setApptEdits((prev) => ({ ...prev, [appt.id]: { ...editing, tags: editing.tags.includes(tag) ? editing.tags.filter((x) => x !== tag) : [...editing.tags, tag] } }))} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1px solid ${selected ? color : BORDER}`, background: selected ? `${color}20` : "transparent", color: selected ? color : "var(--text-dim)", cursor: rowBusy ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
                                {t(tagKey)}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                            <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{t("appointments_a1c_label")}</label>
                            <input style={inp} type="number" min="2" max="20" step="0.1" value={editing.a1c} placeholder={t("appointments_a1c_placeholder")} onChange={(e) => setApptEdits((prev) => ({ ...prev, [appt.id]: { ...editing, a1c: e.target.value } }))} disabled={rowBusy} />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                            <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{t("appointments_egfr_label")}</label>
                            <input style={inp} type="number" min="0" max="200" step="1" value={editing.egfr} placeholder={t("appointments_egfr_placeholder")} onChange={(e) => setApptEdits((prev) => ({ ...prev, [appt.id]: { ...editing, egfr: e.target.value } }))} disabled={rowBusy} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" onClick={() => updateAppointmentAction(appt.id)} disabled={rowBusy} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: ACCENT, color: "var(--on-accent)", fontSize: 13, fontWeight: 600, cursor: rowBusy ? "wait" : "pointer", opacity: rowBusy ? 0.6 : 1 }}>
                            {rowBusy ? t("save_button_busy") : tCommon("save")}
                          </button>
                          <button type="button" onClick={() => setApptEdits((prev) => { const next = { ...prev }; delete next[appt.id]; return next; })} disabled={rowBusy} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "transparent", color: "var(--text-body)", fontSize: 13, fontWeight: 600, cursor: rowBusy ? "not-allowed" : "pointer" }}>
                            {t("appointments_cancel")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{formatted}</div>
                            {appt.tags.map((tag) => (
                              <span key={tag} style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${tagColor(tag)}20`, color: tagColor(tag), border: `1px solid ${tagColor(tag)}40`, letterSpacing: "0.02em" }}>{tag}</span>
                            ))}
                          </div>
                          {appt.note && <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appt.note}</div>}
                          {(appt.a1c !== null || appt.egfr !== null) && (
                            <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                              {appt.a1c !== null && <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>HbA1c <strong style={{ color: "var(--text-strong)" }}>{appt.a1c}%</strong></span>}
                              {appt.egfr !== null && <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>eGFR <strong style={{ color: "var(--text-strong)" }}>{appt.egfr}</strong></span>}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button type="button" onClick={() => setApptEdits((prev) => ({ ...prev, [appt.id]: { date: appt.appointmentAt, note: appt.note ?? "", tags: appt.tags, a1c: appt.a1c !== null ? String(appt.a1c) : "", egfr: appt.egfr !== null ? String(appt.egfr) : "" } }))} disabled={apptBusy !== null} aria-label={t("appointments_edit")} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "var(--surface-soft)", color: "var(--text-body)", fontSize: 13, fontWeight: 600, cursor: apptBusy !== null ? "not-allowed" : "pointer", opacity: apptBusy !== null ? 0.5 : 1 }}>
                            {t("appointments_edit")}
                          </button>
                          <button type="button" onClick={() => deleteAppointmentAction(appt.id)} disabled={apptBusy !== null} aria-label={t("appointments_delete")} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${PINK}40`, background: `${PINK}10`, color: PINK, fontSize: 13, fontWeight: 600, cursor: apptBusy !== null ? "not-allowed" : "pointer", opacity: apptBusy !== null ? 0.5 : 1 }}>
                            {rowBusy ? t("save_button_busy") : t("appointments_delete")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4 }}>{saveError}</div>}
        </div>
      </BottomSheet>
    </div>
  );
}
