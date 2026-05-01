"use client";

import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import { reloadHistoricalEntries } from "@/lib/meals";
import {
  fetchMacroTargets,
  saveMacroTargets,
  DEFAULT_MACRO_TARGETS,
  fetchLastAppointment,
  saveLastAppointment,
  type MacroTargets,
} from "@/lib/userSettings";
import { localeToBcp47 } from "@/lib/time";
import ImportPanel from "@/components/ImportPanel";
import ExportPanel from "@/components/ExportPanel";
import CgmSettingsCard from "@/components/CgmSettingsCard";
import NightscoutSettingsCard from "@/components/NightscoutSettingsCard";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow, ConnectedDot } from "@/components/SettingsRow";
import { setLocale, readLocaleCookie, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { useTheme } from "@/components/ThemeProvider";
import type { ThemeChoice } from "@/lib/theme";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";
import {
  fetchNotificationPrefs,
  saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "@/lib/notificationPrefs";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#FF2D78", PURPLE = "#A78BFA";
const BORDER = "var(--border)";

interface Settings {
  targetMin: number;
  targetMax: number;
  icr: number;
  cf: number;
}

const DEFAULTS: Settings = { targetMin: 70, targetMax: 180, icr: 15, cf: 50 };

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("glev_settings") || "{}") }; }
  catch { return DEFAULTS; }
}

function saveSettings(s: Settings) {
  if (typeof window !== "undefined") localStorage.setItem("glev_settings", JSON.stringify(s));
}

// All bottom-sheet IDs in one union so the row config and the open-state
// stay type-checked together. Adding a new row = extend this union and
// add an entry to `sheetContent` below.
type SheetKey =
  | "targetRange"
  | "units"
  | "icr"
  | "cf"
  | "lastAppointment"
  | "libre2"
  | "nightscout"
  | "dexcom"
  | "notifications"
  | "language"
  | "carbUnit"
  | "export"
  | "appearance"
  | "macros"
  | "import"
  | "historical"
  | "googleSheets";

/** Lightweight CGM status hook — fetches /api/cgm/status once on mount.
 * Silent on error (treats as disconnected). The full CgmSettingsCard owns
 * the source-of-truth fetch + retry; this is purely for the row indicator. */
function useCgmConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setConnected(Boolean(data?.connected)); })
      .catch(() => { /* leave as disconnected */ });
    return () => { cancelled = true; };
  }, []);
  return connected;
}

/** Same pattern for Nightscout — sync route returns { connected: boolean }. */
function useNightscoutConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cgm/nightscout/sync", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (!cancelled) setConnected(Boolean(data?.connected)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return connected;
}

export default function SettingsPage() {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Reflects the NEXT_LOCALE cookie so the language picker highlights the
  // correct option after mount. Server render shows DEFAULT.
  const [currentLocale, setCurrentLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    const fromCookie = readLocaleCookie();
    if (fromCookie) setCurrentLocale(fromCookie);
  }, []);
  // Pending locale-switch waiting for confirmation. setLocale() reloads the
  // page, so we let the user stage a value first and only commit on "Save".
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme();
  // Carb-unit selector (g / BE / KE) — DACH users typically dose in BE
  // (1 BE = 12g) or KE (1 KE = 10g). Optimistic update + persists to
  // profiles.carb_unit; the hook exposes display/conversion helpers used
  // throughout the engine, entries, and insights surfaces.
  const carbUnit = useCarbUnit();
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  // Notification preferences (DB-backed via user_settings.notif_*). Phase 1
  // ships the prefs surface; Phase 2 (web push + cron sender) will start
  // honouring `criticalAlerts` and `quietStart/End`.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  // Last doctor appointment date (YYYY-MM-DD) — drives the optional
  // "Seit letztem Arzttermin" preset chip in the Export panel. Empty
  // string means "not set" (matches what an empty <input type="date">
  // emits) and gets stored as `null` in user_settings; persisted via
  // `saveLastAppointment`. The bcp47 locale is used to render the
  // current value as a localized string in the row subtitle.
  const [lastAppointment, setLastAppointment] = useState<string>("");
  // Optional one-line free-text note attached to the appointment date
  // (Task #92). Doctor name, clinic, key result — anything that turns
  // the saved date into self-explanatory metadata for the next visit.
  // Empty string means "no note" and is persisted as null in
  // user_settings.last_appointment_note. Tied to the same Save / Clear
  // affordances as the date so the two stay in lock-step (clearing the
  // date wipes the note, and the upsert writes both columns).
  const [lastAppointmentNote, setLastAppointmentNote] = useState<string>("");
  const bcp47 = localeToBcp47(useLocale());
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  // Draft snapshot captured the moment a sheet opens. If the user dismisses
  // the sheet via backdrop / ESC / drag-down without saving, we revert the
  // in-memory state to this snapshot so half-typed values don't leak back
  // into the row subtitles. Successful saves clear this snapshot so the
  // new values become the canonical baseline for the next open.
  const [draftSnapshot, setDraftSnapshot] = useState<{
    settings: Settings;
    macroTargets: MacroTargets;
    notifPrefs: NotificationPrefs;
    lastAppointment: string;
    lastAppointmentNote: string;
  } | null>(null);

  const cgmConnected = useCgmConnected();
  const nightscoutConnected = useNightscoutConnected();

  useEffect(() => {
    setSettings(loadSettings());
    if (!supabase) return;
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
    fetchNotificationPrefs().then(setNotifPrefs).catch(() => {});
    // Load the saved appointment date AND note — both DB nulls collapse
    // to "" so the inputs render empty (which is what the user sees
    // when nothing's configured). Single fetch returns both fields so
    // the two state slots can never disagree on the same paint.
    fetchLastAppointment()
      .then(({ date, note }) => {
        setLastAppointment(date ?? "");
        setLastAppointmentNote(note ?? "");
      })
      .catch(() => {});
  }, []);

  const openSheetWith = useCallback((id: SheetKey) => {
    // Snapshot before opening any sheet — even info-only sheets get one,
    // because tracking "is this sheet editable?" branching by id-type
    // would just be ceremony for flat primitive structs.
    setSettings((curSettings) => {
      setMacroTargets((curMacros) => {
        setNotifPrefs((curNotif) => {
          setLastAppointment((curAppt) => {
            setLastAppointmentNote((curNote) => {
              setDraftSnapshot({
                settings: { ...curSettings },
                macroTargets: { ...curMacros },
                notifPrefs: { ...curNotif },
                lastAppointment: curAppt,
                lastAppointmentNote: curNote,
              });
              return curNote;
            });
            return curAppt;
          });
          return curNotif;
        });
        return curMacros;
      });
      return curSettings;
    });
    setSaveError("");
    setOpenSheet(id);
  }, []);

  const closeSheet = useCallback(() => {
    // Revert any unsaved edits to the snapshot taken at open-time. Also
    // discard a staged locale selection so a backdrop-close on the
    // language sheet doesn't leave a "Save" button armed on next visit.
    if (draftSnapshot) {
      setSettings(draftSnapshot.settings);
      setMacroTargets(draftSnapshot.macroTargets);
      setNotifPrefs(draftSnapshot.notifPrefs);
      setLastAppointment(draftSnapshot.lastAppointment);
      setLastAppointmentNote(draftSnapshot.lastAppointmentNote);
      setDraftSnapshot(null);
    }
    setPendingLocale(null);
    setSaveError("");
    setOpenSheet(null);
  }, [draftSnapshot]);

  /** Persist localStorage settings. Used by the Glucose / ICR / CF sheets.
   * Returns true on success so the footer can decide whether to dismiss
   * or keep the sheet open with the inline error visible. */
  const saveLocalSettings = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      // Commit: this baseline IS the new canonical state — clear the snapshot
      // so a subsequent close doesn't revert the just-saved values.
      setDraftSnapshot(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings, tSettings]);

  /** Persist macro targets — DB-backed (user_settings table) so this can fail. */
  const saveMacrosAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await saveMacroTargets(macroTargets);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      setDraftSnapshot(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [macroTargets, tSettings]);

  /** Persist the "last appointment" date AND note — DB-backed via
   *  user_settings.last_appointment_at + last_appointment_note. Empty
   *  date string normalizes to null so the column gets cleared (and
   *  the export panel hides the preset chip + the PDF cover meta line).
   *  The lib layer also force-clears the note when the date is null,
   *  so a user who types a note and then wipes the date never leaves
   *  a dangling note in storage. */
  const saveLastAppointmentAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await saveLastAppointment({
        date: lastAppointment === "" ? null : lastAppointment,
        note: lastAppointmentNote === "" ? null : lastAppointmentNote,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      setDraftSnapshot(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [lastAppointment, lastAppointmentNote, tSettings]);

  /** Persist notification preferences — DB-backed via user_settings.notif_*. */
  const saveNotifPrefsAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await saveNotificationPrefs(notifPrefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      setDraftSnapshot(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [notifPrefs, tSettings]);

  function updNotif<K extends keyof NotificationPrefs>(key: K, val: NotificationPrefs[K]) {
    setNotifPrefs((prev) => ({ ...prev, [key]: val }));
  }

  async function handleReloadHistorical() {
    if (!confirm(tSettings("historical_confirm"))) return;
    setReloading(true);
    setReloadMsg(null);
    try {
      const { inserted } = await reloadHistoricalEntries();
      setReloadMsg({ kind: "ok", text: tSettings("historical_loaded", { count: inserted }) });
    } catch (e) {
      setReloadMsg({ kind: "error", text: tSettings("historical_error", { message: e instanceof Error ? e.message : tSettings("historical_failed") }) });
    } finally {
      setReloading(false);
      setTimeout(() => setReloadMsg(null), 4000);
    }
  }

  function upd<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: val }));
  }

  function updMacro<K extends keyof MacroTargets>(key: K, val: MacroTargets[K]) {
    setMacroTargets((prev) => ({ ...prev, [key]: val }));
  }

  const inp: React.CSSProperties = {
    background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10,
    padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%",
  };

  /* ── icons ─────────────────────────────────────────────────────── */
  const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const ICON = {
    glucose: <svg {...iconProps}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>,
    units: <svg {...iconProps}><path d="M3 7h18M3 12h18M3 17h18" /></svg>,
    insulin: <svg {...iconProps}><path d="M18 6L6 18" /><path d="M14 4l6 6" /><path d="M4 14l6 6" /></svg>,
    cgm: <svg {...iconProps}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>,
    nightscout: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
    dexcom: <svg {...iconProps}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></svg>,
    bell: <svg {...iconProps}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>,
    globe: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
    download: <svg {...iconProps}><path d="M12 3v12" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>,
    appearance: <svg {...iconProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>,
    target: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>,
    upload: <svg {...iconProps}><path d="M12 21V9" /><path d="M6 13l6-6 6 6" /><path d="M4 3h16" /></svg>,
    refresh: <svg {...iconProps}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>,
    sheets: <svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>,
    carbs: <svg {...iconProps}><path d="M12 2v6" /><path d="M9 5l3 3 3-3" /><path d="M5 12c0-3 3-5 7-5s7 2 7 5c0 5-3 9-7 9s-7-4-7-9z" /></svg>,
    calendar: <svg {...iconProps}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  };

  /* ── subtitles derived from current state ──────────────────────── */
  const targetRangeSub = tSettings("subtitle_target_range", { min: settings.targetMin, max: settings.targetMax });
  const icrSub = tSettings("subtitle_icr", { value: settings.icr });
  const cfSub = tSettings("subtitle_cf", { value: settings.cf });
  // Format the saved appointment date in the user's UI locale for the
  // row subtitle (e.g. "12.01.2026" in DE, "Jan 12, 2026" in EN). When
  // a note is also set we append it ("12.01.2026 · Dr. Müller, A1c 7.2")
  // so the user can verify both pieces from the closed row without
  // re-opening the sheet. When the date is unset we show a "noch nicht
  // gesetzt" subtitle so the row's purpose stays discoverable. The
  // empty-string check matches both unset (loaded as "") and cleared
  // inputs.
  const lastAppointmentSub = lastAppointment
    ? (lastAppointmentNote
        ? tSettings("subtitle_last_appointment_set_with_note", {
            date: new Date(`${lastAppointment}T00:00:00`).toLocaleDateString(bcp47, {
              year: "numeric", month: "2-digit", day: "2-digit",
            }),
            note: lastAppointmentNote,
          })
        : tSettings("subtitle_last_appointment_set", {
            date: new Date(`${lastAppointment}T00:00:00`).toLocaleDateString(bcp47, {
              year: "numeric", month: "2-digit", day: "2-digit",
            }),
          }))
    : tSettings("subtitle_last_appointment_unset");
  const macroSub = tSettings("subtitle_macros", {
    carbs: macroTargets.carbs, protein: macroTargets.protein, fat: macroTargets.fat, fiber: macroTargets.fiber,
  });
  const themeSub = useMemo(() => (
    themeChoice === "dark" ? tSettings("theme_dark")
    : themeChoice === "light" ? tSettings("theme_light")
    : tSettings("theme_system")
  ), [themeChoice, tSettings]);
  const localeSub = currentLocale === "de" ? tSettings("subtitle_language_de") : tSettings("subtitle_language_en");
  const notifSub = notifPrefs.criticalAlerts
    ? tSettings("subtitle_notif_on", { from: notifPrefs.quietStart, to: notifPrefs.quietEnd })
    : tSettings("subtitle_notif_off");

  /* ── shared sheet footers ──────────────────────────────────────── */
  /** Save footer: button calls `onSave()`; sheet only dismisses on a true
   * return so an inline error keeps the user's in-progress values visible. */
  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {saveError && (
          <div style={{ fontSize: 12, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>
        )}
        <button
          type="button"
          onClick={async () => {
            const ok = await onSave();
            if (ok) setOpenSheet(null);
          }}
          disabled={saving}
          style={{
            width: "100%", padding: "13px", borderRadius: 12, border: "none",
            cursor: saving ? "wait" : "pointer",
            background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "#fff",
            fontSize: 14, fontWeight: 700,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? tSettings("save_button_busy") : saved ? tSettings("save_button_done") : tCommon("save")}
        </button>
      </div>
    );
  }

  /** Close footer: info-only sheets where there's nothing to save. */
  const closeFooter = (
    <button
      type="button"
      onClick={closeSheet}
      style={{
        width: "100%", padding: "12px 16px", borderRadius: 12,
        border: `1px solid ${BORDER}`, background: "var(--surface-soft)",
        color: "var(--text-strong)", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}
    >
      {tSettings("sheet_close")}
    </button>
  );

  /* ── sheet content blocks ──────────────────────────────────────── */
  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer?: ReactNode }> = {
    targetRange: {
      title: tSettings("row_target_range"),
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("target_min")}</label>
            <input style={inp} type="number" value={settings.targetMin} onChange={(e) => upd("targetMin", parseInt(e.target.value) || 70)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("target_max")}</label>
            <input style={inp} type="number" value={settings.targetMax} onChange={(e) => upd("targetMax", parseInt(e.target.value) || 180)} />
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveLocalSettings} />,
    },
    units: {
      title: tSettings("sheet_units_title"),
      body: (
        <p style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>
          {tSettings("sheet_units_body")}
        </p>
      ),
      footer: closeFooter,
    },
    icr: {
      title: tSettings("insulin_to_carb_ratio"),
      body: (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("icr_label")}</label>
          <input style={inp} type="number" value={settings.icr} onChange={(e) => upd("icr", parseInt(e.target.value) || 15)} />
          <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 6 }}>{tSettings("icr_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveLocalSettings} />,
    },
    cf: {
      title: tSettings("correction_factor"),
      body: (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("cf_label")}</label>
          <input style={inp} type="number" value={settings.cf} onChange={(e) => upd("cf", parseInt(e.target.value) || 50)} />
          <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 6 }}>{tSettings("cf_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveLocalSettings} />,
    },
    lastAppointment: {
      // Two-field sheet that lets the user record (or clear) the date
      // of their last doctor appointment AND a short doctor-friendly
      // note (e.g. "Dr. Müller, A1c 7.2"). The Export panel reads both
      // via fetchLastAppointment(): the date drives the "Seit letztem
      // Arzttermin (DD.MM.YYYY)" preset chip, and the note (when set)
      // is rendered alongside the date on the PDF cover so the export
      // is self-explanatory for the next visit. Clearing the date
      // wipes the note too — one button, both columns.
      title: tSettings("last_appointment_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("last_appointment_hint")}
          </div>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block" }}>
            {tSettings("last_appointment_label")}
            <input
              style={{ ...inp, marginTop: 6 }}
              type="date"
              value={lastAppointment}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setLastAppointment(e.target.value)}
            />
          </label>
          {/* Optional one-line note. We keep it as a plain text input
              (not a textarea) on purpose: the value renders on the
              PDF cover meta block, where wrapping a multi-line note
              would push the rest of the meta down and look messy.
              maxLength matches the lib-layer NOTE_MAX_LEN cap so the
              field's behaviour stays in sync with what gets persisted.
              Disabled when no date is set — a note without a date has
              no surface to attach to (the PDF meta line is anchored to
              the date) and the lib layer would force-clear it on
              save anyway, so disabling here surfaces that contract
              upfront instead of letting the user type into a field
              that would silently get wiped on Save. */}
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block" }}>
            {tSettings("last_appointment_note_label")}
            <input
              style={{
                ...inp,
                marginTop: 6,
                opacity: lastAppointment ? 1 : 0.6,
              }}
              type="text"
              value={lastAppointmentNote}
              onChange={(e) => setLastAppointmentNote(e.target.value)}
              placeholder={tSettings("last_appointment_note_placeholder")}
              maxLength={200}
              disabled={!lastAppointment}
            />
          </label>
          {/* Inline "Clear" affordance — the user can also pick a date
              and then wipe it via the native input, but iOS Safari
              doesn't always expose a clear button on date inputs, so
              we ship our own. Wipes BOTH the date and the note in one
              press (the note is meaningless without a date and the
              save layer would null it out anyway, so do it visibly
              here to keep the UI honest). Disabled when both fields
              are already empty so the button doesn't look pressable
              when it's a no-op. */}
          <button
            type="button"
            onClick={() => {
              setLastAppointment("");
              setLastAppointmentNote("");
            }}
            disabled={!lastAppointment && !lastAppointmentNote}
            style={{
              alignSelf: "flex-start",
              padding: "8px 14px", borderRadius: 9,
              border: `1px solid ${BORDER}`,
              background: "var(--surface-soft)",
              color: (lastAppointment || lastAppointmentNote) ? "var(--text-strong)" : "var(--text-faint)",
              fontSize: 12, fontWeight: 600,
              cursor: (lastAppointment || lastAppointmentNote) ? "pointer" : "not-allowed",
              opacity: (lastAppointment || lastAppointmentNote) ? 1 : 0.6,
            }}
          >
            {tSettings("last_appointment_clear")}
          </button>
        </div>
      ),
      footer: <SaveFooter onSave={saveLastAppointmentAction} />,
    },
    libre2: {
      title: tSettings("row_libre2"),
      body: <CgmSettingsCard />,
      footer: closeFooter,
    },
    nightscout: {
      title: tSettings("row_nightscout"),
      body: <NightscoutSettingsCard />,
      footer: closeFooter,
    },
    dexcom: {
      title: tSettings("sheet_dexcom_title"),
      body: (
        <p style={{ fontSize: 13, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>
          {tSettings("sheet_dexcom_body")}
        </p>
      ),
      footer: closeFooter,
    },
    notifications: {
      title: tSettings("notifications"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Critical alerts toggle */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{tSettings("notif_critical_label")}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{tSettings("notif_critical_desc")}</div>
            </div>
            <div
              role="switch"
              aria-checked={notifPrefs.criticalAlerts}
              onClick={() => updNotif("criticalAlerts", !notifPrefs.criticalAlerts)}
              style={{
                width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0,
                background: notifPrefs.criticalAlerts ? ACCENT : "var(--border-strong)",
                border: `1px solid ${notifPrefs.criticalAlerts ? ACCENT + "60" : BORDER}`,
                position: "relative", transition: "background 0.2s",
              }}
            >
              <div style={{ position: "absolute", top: 2, left: notifPrefs.criticalAlerts ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>

          {/* Smart reminders toggle — disabled in Phase 1; learning + delivery
              ship in Phase 2. Kept visible so users see what's coming and the
              setting persists across the rollout. Visual state binds to the
              DB value so Phase 2 only needs to drop the disabled styling. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12, opacity: 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{tSettings("notif_smart_label")}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{tSettings("notif_smart_soon")}</div>
            </div>
            <div
              role="switch"
              aria-checked={notifPrefs.smartReminders}
              aria-disabled
              style={{
                width: 44, height: 24, borderRadius: 99, cursor: "not-allowed", flexShrink: 0,
                background: "var(--border-strong)",
                border: `1px solid ${BORDER}`,
                position: "relative",
              }}
            >
              <div style={{ position: "absolute", top: 2, left: notifPrefs.smartReminders ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>

          {/* Quiet hours from–to */}
          <div style={{ padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{tSettings("notif_quiet_label")}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 10 }}>{tSettings("notif_quiet_desc")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-body)" }}>{tSettings("notif_quiet_from")}</span>
              <input
                type="time"
                value={notifPrefs.quietStart}
                onChange={(e) => updNotif("quietStart", e.target.value)}
                style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 13 }}
              />
              <span style={{ fontSize: 12, color: "var(--text-body)" }}>{tSettings("notif_quiet_to")}</span>
              <input
                type="time"
                value={notifPrefs.quietEnd}
                onChange={(e) => updNotif("quietEnd", e.target.value)}
                style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 13 }}
              />
            </div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveNotifPrefsAction} />,
    },
    language: {
      title: tSettings("language_card_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <select
              value={pendingLocale ?? currentLocale}
              onChange={(e) => {
                const next = e.target.value as Locale;
                setPendingLocale(next === currentLocale ? null : next);
              }}
              style={{
                flex: 1, padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${BORDER}`, background: "var(--surface)",
                color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer",
                appearance: "none", WebkitAppearance: "none",
                backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M2 4l4 4 4-4z'/></svg>\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
                paddingRight: 36,
              }}
            >
              <option value="de">🇩🇪 Deutsch</option>
              <option value="en">🇬🇧 English</option>
            </select>
            <button
              type="button"
              disabled={!pendingLocale}
              onClick={() => {
                if (!pendingLocale) return;
                const target = pendingLocale;
                setCurrentLocale(target);
                void setLocale(target);
              }}
              style={{
                padding: "12px 22px", borderRadius: 10,
                border: `1px solid ${pendingLocale ? ACCENT : BORDER}`,
                background: pendingLocale ? ACCENT : "transparent",
                color: pendingLocale ? "#fff" : "var(--text-faint)",
                fontSize: 14, fontWeight: 600,
                cursor: pendingLocale ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
                transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
              }}
            >
              {tCommon("save")}
            </button>
          </div>
          {pendingLocale && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {tSettings("language_confirm_body")}
            </div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
    export: {
      title: tSettings("row_export"),
      body: <ExportPanel />,
      footer: closeFooter,
    },
    appearance: {
      title: tSettings("appearance"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("appearance_hint")}
          </div>
          <div role="radiogroup" aria-label={tSettings("appearance")} style={{
            display: "flex", gap: 2, padding: 4, borderRadius: 99,
            background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
          }}>
            {([
              { v: "dark" as ThemeChoice, label: tSettings("theme_dark") },
              { v: "light" as ThemeChoice, label: tSettings("theme_light") },
              { v: "system" as ThemeChoice, label: tSettings("theme_system") },
            ]).map((opt) => {
              const active = themeChoice === opt.v;
              return (
                <button
                  key={opt.v}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setThemeChoice(opt.v)}
                  style={{
                    flex: 1,
                    padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                    background: active ? ACCENT : "transparent",
                    color: active ? "#fff" : "var(--text-body)",
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    transition: "background 120ms ease, color 120ms ease",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ),
      footer: closeFooter,
    },
    carbUnit: {
      title: tSettings("carb_unit_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("carb_unit_hint")}
          </div>
          <div role="radiogroup" aria-label={tSettings("carb_unit_title")} style={{
            display: "flex", gap: 2, padding: 4, borderRadius: 99,
            background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
          }}>
            {([
              { v: "g" as CarbUnit, label: tSettings("carb_unit_g") },
              { v: "BE" as CarbUnit, label: tSettings("carb_unit_be") },
              { v: "KE" as CarbUnit, label: tSettings("carb_unit_ke") },
            ]).map((opt) => {
              const active = carbUnit.unit === opt.v;
              return (
                <button
                  key={opt.v}
                  role="radio"
                  aria-checked={active}
                  onClick={() => carbUnit.setUnit(opt.v)}
                  style={{
                    flex: 1,
                    padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                    background: active ? ACCENT : "transparent",
                    color: active ? "#fff" : "var(--text-body)",
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    transition: "background 120ms ease, color 120ms ease",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {carbUnit.description}
          </div>
        </div>
      ),
      footer: closeFooter,
    },
    macros: {
      title: tSettings("daily_macros_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("daily_macros_desc")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {([
              { key: "carbs", label: tSettings("macro_carbs_label"), def: 250, max: 2000 },
              { key: "protein", label: tSettings("macro_protein_label"), def: 120, max: 2000 },
              { key: "fat", label: tSettings("macro_fat_label"), def: 80, max: 2000 },
              { key: "fiber", label: tSettings("macro_fiber_label"), def: 30, max: 200 },
            ] as Array<{ key: keyof MacroTargets; label: string; def: number; max: number }>).map((target) => (
              <div key={target.key}>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{target.label}</label>
                <input
                  style={inp}
                  type="number"
                  min={0}
                  max={target.max}
                  value={macroTargets[target.key]}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    updMacro(target.key, Number.isFinite(n) ? Math.max(0, Math.min(target.max, n)) : target.def);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveMacrosAction} />,
    },
    import: {
      title: tSettings("row_import"),
      body: <ImportPanel embedded />,
      footer: closeFooter,
    },
    historical: {
      title: tSettings("row_historical_reload"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55 }}>
            {tSettings("historical_intro")}
          </div>
          <button
            onClick={handleReloadHistorical}
            disabled={reloading}
            style={{
              padding: "12px 18px", borderRadius: 10, border: `1px solid ${ACCENT}40`,
              cursor: reloading ? "wait" : "pointer",
              background: `${ACCENT}15`, color: ACCENT, fontSize: 13, fontWeight: 600,
              opacity: reloading ? 0.6 : 1,
            }}
          >
            {reloading ? tSettings("historical_loading") : tSettings("historical_reload")}
          </button>
          {reloadMsg && (
            <div style={{ fontSize: 12, color: reloadMsg.kind === "error" ? PINK : GREEN }}>{reloadMsg.text}</div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
    googleSheets: {
      title: tSettings("google_sheets_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap",
            background: "var(--surface-soft)", borderRadius: 12, padding: "14px 16px",
            border: `1px solid ${BORDER}`,
          }}>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 2 }}>
                {tSettings("google_sheets_title")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {tSettings("google_sheets_desc")}
              </div>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
              background: "var(--surface)", color: "var(--text-dim)",
              border: `1px solid ${BORDER}`, letterSpacing: "0.08em", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              {tSettings("coming_soon")}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.55 }}>
            {tSettings("google_sheets_footnote")}
          </div>
        </div>
      ),
      footer: closeFooter,
    },
  };

  const active = openSheet ? sheetContent[openSheet] : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
          {tSettings("page_title")}
        </h1>
        <p style={{ color: "var(--text-faint)", fontSize: 14 }}>{tSettings("page_subtitle")}</p>
      </div>

      <SettingsSection title={tSettings("section_glucose")}>
        <SettingsRow
          first
          iconColor={GREEN}
          icon={ICON.glucose}
          label={tSettings("row_target_range")}
          subtitle={targetRangeSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_target_range") })}
          onClick={() => openSheetWith("targetRange")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={ICON.units}
          label={tSettings("row_units")}
          subtitle={tSettings("subtitle_unit_mgdl")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_units") })}
          onClick={() => openSheetWith("units")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_insulin")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.insulin}
          label={tSettings("insulin_to_carb_ratio")}
          subtitle={icrSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("insulin_to_carb_ratio") })}
          onClick={() => openSheetWith("icr")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.target}
          label={tSettings("correction_factor")}
          subtitle={cfSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("correction_factor") })}
          onClick={() => openSheetWith("cf")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.calendar}
          label={tSettings("last_appointment_title")}
          subtitle={lastAppointmentSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("last_appointment_title") })}
          onClick={() => openSheetWith("lastAppointment")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_cgm")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.cgm}
          label={tSettings("row_libre2")}
          rightAdornment={cgmConnected ? <ConnectedDot label={tSettings("status_connected")} /> : undefined}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_libre2") })}
          onClick={() => openSheetWith("libre2")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.nightscout}
          label={tSettings("row_nightscout")}
          rightAdornment={nightscoutConnected ? <ConnectedDot label={tSettings("status_connected")} /> : undefined}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_nightscout") })}
          onClick={() => openSheetWith("nightscout")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.dexcom}
          label={tSettings("row_cgm_dexcom")}
          subtitle={tSettings("subtitle_coming_soon")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_cgm_dexcom") })}
          onClick={() => openSheetWith("dexcom")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_app")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.bell}
          label={tSettings("notifications")}
          subtitle={notifSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("notifications") })}
          onClick={() => openSheetWith("notifications")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.globe}
          label={tSettings("row_language")}
          subtitle={localeSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_language") })}
          onClick={() => openSheetWith("language")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.carbs}
          label={tSettings("row_carb_unit")}
          subtitle={carbUnit.label}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_carb_unit") })}
          onClick={() => openSheetWith("carbUnit")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.download}
          label={tSettings("row_export")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_export") })}
          onClick={() => openSheetWith("export")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_appearance")}>
        <SettingsRow
          first
          iconColor={PURPLE}
          icon={ICON.appearance}
          label={tSettings("appearance")}
          subtitle={themeSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("appearance") })}
          onClick={() => openSheetWith("appearance")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_goals")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.target}
          label={tSettings("daily_macros_title")}
          subtitle={macroSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("daily_macros_title") })}
          onClick={() => openSheetWith("macros")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_data")}>
        <SettingsRow
          first
          iconColor={GREEN}
          icon={ICON.upload}
          label={tSettings("row_import")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_import") })}
          onClick={() => openSheetWith("import")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={ICON.refresh}
          label={tSettings("row_historical_reload")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_historical_reload") })}
          onClick={() => openSheetWith("historical")}
        />
      </SettingsSection>

      <SettingsSection title={tSettings("section_integrations")}>
        <SettingsRow
          first
          iconColor={GREEN}
          icon={ICON.sheets}
          label={tSettings("google_sheets_title")}
          subtitle={tSettings("subtitle_coming_soon")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("google_sheets_title") })}
          onClick={() => openSheetWith("googleSheets")}
        />
      </SettingsSection>

      <p style={{
        marginTop: 36, marginBottom: 8,
        marginLeft: "auto", marginRight: "auto",
        maxWidth: 560, fontSize: 11, lineHeight: 1.55,
        color: "var(--text-faint)", textAlign: "center",
      }}>
        {tSettings("footer_disclaimer")}
      </p>

      <BottomSheet
        open={openSheet !== null}
        onClose={closeSheet}
        title={active?.title}
        footer={active?.footer}
      >
        {active?.body}
      </BottomSheet>
    </div>
  );
}
