"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { signOut, getCurrentUser } from "@/lib/auth";
import { parseDbDate } from "@/lib/time";
import { reloadHistoricalEntries } from "@/lib/meals";
import {
  fetchMacroTargets,
  saveMacroTargets,
  DEFAULT_MACRO_TARGETS,
  type MacroTargets,
  fetchInsulinSettings,
  saveInsulinSettings,
  DEFAULT_INSULIN_SETTINGS,
} from "@/lib/userSettings";
import {
  fetchAppointments,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  type Appointment,
} from "@/lib/appointments";
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
  /** Target BG for the dose recommender (mg/dL). Mirrors
   *  `user_settings.target_bg_mgdl` so the sync `getInsulinSettings()`
   *  caller stays in lock-step with the DB source of truth. */
  targetBg: number;
}

const DEFAULTS: Settings = {
  targetMin: 70,
  targetMax: 180,
  icr: DEFAULT_INSULIN_SETTINGS.icr,
  cf: DEFAULT_INSULIN_SETTINGS.cf,
  targetBg: DEFAULT_INSULIN_SETTINGS.targetBg,
};

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
  | "account"
  | "targetRange"
  | "units"
  | "icr"
  | "cf"
  | "targetBg"
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
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  // Tracks whether the user has manually touched any insulin field
  // (icr / cf / targetBg) before the async `fetchInsulinSettings` round
  // trip resolves. Without this gate the late DB-load callback would
  // race with — and clobber — an in-flight edit, e.g. opening the ICR
  // sheet right after navigation, typing 12, hitting Save, but having
  // the fetched 15 land between the keystroke and the save handler
  // reading from state. See Task #40 e2e regression for details.
  const insulinTouchedRef = useRef(false);
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
  // List of doctor appointments (Task #93). The most recent entry by
  // date drives the Export panel's "Seit letztem Arzttermin" preset
  // chip the same way the legacy single-date setting did; older
  // entries are also surfaced through an optional dropdown in the
  // Export panel and an add/edit/delete list in the Settings sheet
  // below. Empty list = "no appointments yet" → no chip shown.
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // Per-row inline-edit drafts (date + note) for the lastAppointment
  // sheet. Keyed by appointment id; presence in the map means the row
  // is in edit mode, absence means it's in read mode. Stored alongside
  // `appointments` rather than inside each row so cancelling an edit
  // doesn't have to mutate the list and risk re-ordering.
  const [apptEdits, setApptEdits] = useState<Record<string, { date: string; note: string }>>({});
  // Draft state for the "add new appointment" form at the top of the
  // sheet. Defaults to today so the common "I just got back from a
  // visit" flow is one click; the user can pick another date if they
  // want to record an older one.
  const [newApptDate, setNewApptDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [newApptNote, setNewApptNote] = useState<string>("");
  // Distinguish in-flight save from idle. Only enables a single
  // pending op at a time (add OR edit OR delete) — multiple
  // concurrent writes against the same row would race the optimistic
  // local-state update and could leave the list out of sync.
  const [apptBusy, setApptBusy] = useState<string | null>(null);
  const bcp47 = localeToBcp47(useLocale());
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // Account info for the new "Account" row + sheet (Task #54). Lives on the
  // settings page itself rather than in a separate component because the spec
  // calls for new i18n keys under the `settings` namespace and reuse of the
  // existing SettingsRow/BottomSheet patterns. Loaded once on mount; failures
  // collapse to empty placeholders so the sheet still renders a usable
  // Sign Out button when offline.
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [accountCreatedAt, setAccountCreatedAt] = useState<string>("");
  const [accountMealCount, setAccountMealCount] = useState<number>(0);
  const [signingOut, setSigningOut] = useState(false);

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
  } | null>(null);

  const cgmConnected = useCgmConnected();
  const nightscoutConnected = useNightscoutConnected();

  useEffect(() => {
    setSettings(loadSettings());
    if (!supabase) return;
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
    fetchNotificationPrefs().then(setNotifPrefs).catch(() => {});
    // Insulin parameters (ICR / CF / target BG) live in `user_settings`
    // — the DB row is the source of truth. We merge it into the local
    // Settings state so the row subtitles reflect the real saved
    // values on first paint, and also write the merged values back to
    // localStorage so the sync `getInsulinSettings()` mirror stays in
    // lock-step. The saved targetMin/targetMax range is not touched
    // here because it isn't yet DB-backed.
    fetchInsulinSettings()
      .then((ins) => {
        // Bail out if the user has already started editing — they would
        // see their typed value silently snap back to the fetched one.
        if (insulinTouchedRef.current) return;
        setSettings((prev) => {
          const next = { ...prev, icr: ins.icr, cf: ins.cf, targetBg: ins.targetBg };
          saveSettings(next);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {
        // Once the load has settled (applied or skipped), the ref has
        // served its purpose. Clearing it lets a future re-fetch (if
        // we ever add one) behave normally instead of being permanently
        // suppressed by a stale "touched" marker from earlier in the
        // session.
        insulinTouchedRef.current = false;
      });
    // Load the appointment list. Errors collapse to an empty list,
    // which is the same UI as "no appointments saved yet" — no need
    // to surface a separate error state on the row subtitle.
    fetchAppointments().then(setAppointments).catch(() => {});
    // Load account info (email + sign-up date + total meal count) for the
    // Account row subtitle and sheet. Each piece is best-effort: failures
    // leave the placeholder ("—") in place rather than blocking the row.
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setAccountEmail(user?.email ?? "");
        setAccountCreatedAt(
          user?.created_at
            ? parseDbDate(user.created_at).toLocaleDateString(bcp47, {
                year: "numeric", month: "long", day: "numeric",
              })
            : "",
        );
      } catch { /* leave email/createdAt empty */ }
      try {
        if (!supabase) return;
        const { count } = await supabase
          .from("meals")
          .select("id", { count: "exact", head: true });
        if (!cancelled) setAccountMealCount(count ?? 0);
      } catch { /* leave count at 0 */ }
    })();
    return () => { cancelled = true; };
  }, [bcp47]);

  /** Sign the current user out and bounce them to /login. The sheet is
   * closed first so the post-redirect render doesn't briefly show the
   * still-open backdrop on top of the login page. */
  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      setOpenSheet(null);
      router.push("/login");
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  const openSheetWith = useCallback((id: SheetKey) => {
    // Snapshot before opening any sheet — even info-only sheets get one,
    // because tracking "is this sheet editable?" branching by id-type
    // would just be ceremony for flat primitive structs.
    setSettings((curSettings) => {
      setMacroTargets((curMacros) => {
        setNotifPrefs((curNotif) => {
          setDraftSnapshot({
            settings: { ...curSettings },
            macroTargets: { ...curMacros },
            notifPrefs: { ...curNotif },
          });
          return curNotif;
        });
        return curMacros;
      });
      return curSettings;
    });
    // Reset the appointment-sheet's transient draft state every time a
    // sheet opens — even non-appointment sheets — so the user always
    // sees the "add" form pre-filled to today and any abandoned inline
    // edit from a previous open is discarded.
    setApptEdits({});
    setNewApptDate(new Date().toISOString().slice(0, 10));
    setNewApptNote("");
    setApptBusy(null);
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
      setDraftSnapshot(null);
    }
    // Clear any in-progress inline edits in the appointments sheet
    // so re-opening it shows the canonical (server-state) list. We
    // don't snapshot/restore the list itself: every list mutation
    // is committed straight to the DB via add/update/delete, so
    // there's no in-memory "draft list" to revert.
    setApptEdits({});
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

  /** Persist insulin parameters (ICR / CF / target BG) to the
   *  `user_settings` row so the lifecycle / dose recommender pick them
   *  up on the next async read, AND mirror them into localStorage so
   *  the sync `getInsulinSettings()` caller stays in lock-step. Inputs
   *  are clamped to the migration's CHECK ranges (ICR 1–100, CF 1–500,
   *  target BG 60–200) before the upsert so a Postgres rejection only
   *  fires for a truly malformed write. */
  const saveInsulinAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      const clamped = {
        icr:      Math.min(100, Math.max(1, Math.round(settings.icr))),
        cf:       Math.min(500, Math.max(1, Math.round(settings.cf))),
        targetBg: Math.min(200, Math.max(60, Math.round(settings.targetBg))),
      };
      await saveInsulinSettings(clamped);
      // Mirror the clamped values back into local state + localStorage
      // so the sync `getInsulinSettings()` caller (engine evaluation
      // path) and the row subtitles see exactly what we just wrote.
      const next = { ...settings, ...clamped };
      setSettings(next);
      saveSettings(next);
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

  /** Append a new appointment to the list. Optimistic-ish: we wait for
   *  the insert to land (so the row gets its server-issued id and we
   *  can offer per-row edit/delete immediately) but the busy state
   *  keeps the form locked so the user can't double-submit during the
   *  round-trip. The list is re-sorted after insert because the new
   *  date may not be the latest one — the user might be backfilling
   *  an older visit. */
  const addAppointmentAction = useCallback(async (): Promise<void> => {
    if (!newApptDate) {
      setSaveError(tSettings("appointments_date_required"));
      return;
    }
    setApptBusy("__add__");
    setSaveError("");
    try {
      const inserted = await addAppointment(newApptDate, newApptNote);
      setAppointments((prev) =>
        [inserted, ...prev].sort(
          (a, b) => b.appointmentAt.localeCompare(a.appointmentAt),
        ),
      );
      // Reset the form so a quick "log another" flow stays fluid.
      setNewApptDate(new Date().toISOString().slice(0, 10));
      setNewApptNote("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
    } finally {
      setApptBusy(null);
    }
  }, [newApptDate, newApptNote, tSettings]);

  /** Commit an inline-edit draft for an existing appointment. Local
   *  state is updated only after the DB write succeeds so a failed
   *  update doesn't leave the row out of sync with the server.
   *  Removes the draft from `apptEdits` on success so the row pops
   *  back into read mode. */
  const updateAppointmentAction = useCallback(
    async (id: string): Promise<void> => {
      const draft = apptEdits[id];
      if (!draft) return;
      if (!draft.date) {
        setSaveError(tSettings("appointments_date_required"));
        return;
      }
      setApptBusy(id);
      setSaveError("");
      try {
        await updateAppointment(id, draft.date, draft.note);
        setAppointments((prev) =>
          prev
            .map((a) =>
              a.id === id
                ? {
                    ...a,
                    appointmentAt: draft.date,
                    note: draft.note.trim() === "" ? null : draft.note.trim(),
                  }
                : a,
            )
            .sort((a, b) => b.appointmentAt.localeCompare(a.appointmentAt)),
        );
        setApptEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      } finally {
        setApptBusy(null);
      }
    },
    [apptEdits, tSettings],
  );

  /** Delete a single appointment after a native confirm. Confirm
   *  before delete because the row carries the user's appointment
   *  date — which they may have referenced in an export — and an
   *  accidental tap on a small icon would otherwise lose data. */
  const deleteAppointmentAction = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(tSettings("appointments_delete_confirm"))) return;
      setApptBusy(id);
      setSaveError("");
      try {
        await deleteAppointment(id);
        setAppointments((prev) => prev.filter((a) => a.id !== id));
        setApptEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      } finally {
        setApptBusy(null);
      }
    },
    [tSettings],
  );

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
    // Mark insulin fields as "user-touched" so the in-flight load
    // effect does not race in and overwrite the typed value.
    if (key === "icr" || key === "cf" || key === "targetBg") {
      insulinTouchedRef.current = true;
    }
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
    account: <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>,
  };

  /* ── subtitles derived from current state ──────────────────────── */
  const targetRangeSub = tSettings("subtitle_target_range", { min: settings.targetMin, max: settings.targetMax });
  const icrSub = tSettings("subtitle_icr", { value: settings.icr });
  const cfSub = tSettings("subtitle_cf", { value: settings.cf });
  const targetBgSub = tSettings("subtitle_target_bg", { value: settings.targetBg });
  // Row subtitle: most-recent appointment date + total count when more
  // than one is on file ("12.01.2026 · 4 saved"), or just the date for
  // a single entry, or a "not set" placeholder when the list is empty.
  // The closed-row state surfaces both "what does the export use by
  // default" and "how many do I have on record" without requiring the
  // user to open the sheet.
  const latestAppointment = appointments[0] ?? null;
  const lastAppointmentSub = latestAppointment
    ? appointments.length > 1
      ? tSettings("subtitle_appointments_many", {
          date: new Date(`${latestAppointment.appointmentAt}T00:00:00`).toLocaleDateString(bcp47, {
            year: "numeric", month: "2-digit", day: "2-digit",
          }),
          count: appointments.length,
        })
      : tSettings("subtitle_last_appointment_set", {
          date: new Date(`${latestAppointment.appointmentAt}T00:00:00`).toLocaleDateString(bcp47, {
            year: "numeric", month: "2-digit", day: "2-digit",
          }),
        })
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
    account: {
      // Re-introduces the profile/stats block (email · sign-up date · total
      // meals · sign out) that lived on the old tabbed settings page.
      // Per Task #54 it gets its own dedicated row + sheet so the rest of
      // the iOS-style list stays focused on per-feature settings.
      title: tSettings("account_sheet_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Email row — primary identity, shown at top */}
          <div style={{
            padding: "12px 14px", borderRadius: 12,
            background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
              {tSettings("account_email_label")}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 600, color: "var(--text-strong)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {accountEmail || "—"}
            </div>
          </div>

          {/* Two stat tiles: sign-up date + total meal count */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{
              padding: "12px 14px", borderRadius: 12,
              background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
            }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
                {tSettings("account_member_since_label")}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>
                {accountCreatedAt || "—"}
              </div>
            </div>
            <div style={{
              padding: "12px 14px", borderRadius: 12,
              background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
            }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
                {tSettings("account_meals_logged_label")}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>
                {accountMealCount}
              </div>
            </div>
          </div>

          {/* Sign-out CTA — destructive styling so it's visually distinct
              from the neutral info tiles above. */}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            style={{
              width: "100%", padding: "13px 16px", borderRadius: 12,
              border: `1px solid ${PINK}40`, background: `${PINK}15`,
              color: PINK, fontSize: 14, fontWeight: 700,
              cursor: signingOut ? "wait" : "pointer",
              marginTop: 4,
            }}
          >
            {signingOut ? tSettings("account_signing_out") : tSettings("account_sign_out")}
          </button>
        </div>
      ),
      footer: closeFooter,
    },
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
          <input
            style={inp}
            type="number"
            min={1}
            max={100}
            step={1}
            value={settings.icr}
            onChange={(e) => upd("icr", parseInt(e.target.value) || DEFAULT_INSULIN_SETTINGS.icr)}
          />
          <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 6 }}>{tSettings("icr_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    cf: {
      title: tSettings("correction_factor"),
      body: (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("cf_label")}</label>
          <input
            style={inp}
            type="number"
            min={1}
            max={500}
            step={1}
            value={settings.cf}
            onChange={(e) => upd("cf", parseInt(e.target.value) || DEFAULT_INSULIN_SETTINGS.cf)}
          />
          <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 6 }}>{tSettings("cf_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    targetBg: {
      title: tSettings("row_target_bg"),
      body: (
        <div>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("target_bg_label")}</label>
          <input
            style={inp}
            type="number"
            min={60}
            max={200}
            step={1}
            value={settings.targetBg}
            onChange={(e) => upd("targetBg", parseInt(e.target.value) || DEFAULT_INSULIN_SETTINGS.targetBg)}
          />
          <div style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 6 }}>{tSettings("target_bg_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    lastAppointment: {
      // List-shaped sheet (Task #93) that lets the user keep a small
      // log of doctor appointments instead of just one. The Export
      // panel reads `appointments` via fetchLatestAppointmentDate()
      // for its default chip and via fetchAppointments() for the "..."
      // dropdown of older entries — adding/removing rows here updates
      // both surfaces on the next panel mount.
      title: tSettings("appointments_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("appointments_hint")}
          </div>

          {/* Add form — sits at the top so adding a fresh entry is the
              default action when the sheet opens. Date pre-fills to
              today; note is optional and freeform so the user can
              tag visits ("Endo Q1") for the dropdown later. */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 10,
            padding: "12px 14px", borderRadius: 12,
            background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-strong)" }}>
              {tSettings("appointments_add_title")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={{ ...inp, flex: "1 1 140px", minWidth: 130 }}
                type="date"
                value={newApptDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNewApptDate(e.target.value)}
                aria-label={tSettings("appointments_date_label")}
                disabled={apptBusy !== null}
              />
              <input
                style={{ ...inp, flex: "2 1 180px" }}
                type="text"
                value={newApptNote}
                placeholder={tSettings("appointments_note_placeholder")}
                onChange={(e) => setNewApptNote(e.target.value)}
                aria-label={tSettings("appointments_note_label")}
                disabled={apptBusy !== null}
                maxLength={200}
              />
            </div>
            <button
              type="button"
              onClick={addAppointmentAction}
              disabled={apptBusy !== null || !newApptDate}
              style={{
                alignSelf: "flex-start",
                padding: "8px 16px", borderRadius: 9, border: "none",
                background: `${ACCENT}`, color: "#fff",
                fontSize: 12, fontWeight: 700,
                cursor: apptBusy !== null || !newApptDate ? "not-allowed" : "pointer",
                opacity: apptBusy !== null || !newApptDate ? 0.6 : 1,
              }}
            >
              {apptBusy === "__add__"
                ? tSettings("appointments_add_busy")
                : tSettings("appointments_add_button")}
            </button>
          </div>

          {/* List of saved appointments. Empty state explains the
              feature so the user knows what to do when there's
              nothing to show yet. */}
          {appointments.length === 0 ? (
            <div style={{
              padding: "16px 14px", borderRadius: 12,
              border: `1px dashed ${BORDER}`,
              fontSize: 12, color: "var(--text-faint)",
              textAlign: "center", lineHeight: 1.5,
            }}>
              {tSettings("appointments_empty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {appointments.map((appt) => {
                const editing = apptEdits[appt.id];
                const rowBusy = apptBusy === appt.id;
                const formatted = new Date(`${appt.appointmentAt}T00:00:00`)
                  .toLocaleDateString(bcp47, {
                    year: "numeric", month: "2-digit", day: "2-digit",
                  });
                return (
                  <div
                    key={appt.id}
                    style={{
                      padding: "10px 12px", borderRadius: 10,
                      border: `1px solid ${BORDER}`,
                      background: "var(--surface)",
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    {editing ? (
                      <>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input
                            style={{ ...inp, flex: "1 1 140px", minWidth: 130 }}
                            type="date"
                            value={editing.date}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) =>
                              setApptEdits((prev) => ({
                                ...prev,
                                [appt.id]: { ...editing, date: e.target.value },
                              }))
                            }
                            aria-label={tSettings("appointments_date_label")}
                            disabled={rowBusy}
                          />
                          <input
                            style={{ ...inp, flex: "2 1 180px" }}
                            type="text"
                            value={editing.note}
                            placeholder={tSettings("appointments_note_placeholder")}
                            onChange={(e) =>
                              setApptEdits((prev) => ({
                                ...prev,
                                [appt.id]: { ...editing, note: e.target.value },
                              }))
                            }
                            aria-label={tSettings("appointments_note_label")}
                            disabled={rowBusy}
                            maxLength={200}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => updateAppointmentAction(appt.id)}
                            disabled={rowBusy}
                            style={{
                              padding: "6px 14px", borderRadius: 8, border: "none",
                              background: ACCENT, color: "#fff",
                              fontSize: 12, fontWeight: 600,
                              cursor: rowBusy ? "wait" : "pointer",
                              opacity: rowBusy ? 0.6 : 1,
                            }}
                          >
                            {rowBusy
                              ? tSettings("save_button_busy")
                              : tCommon("save")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setApptEdits((prev) => {
                                const next = { ...prev };
                                delete next[appt.id];
                                return next;
                              })
                            }
                            disabled={rowBusy}
                            style={{
                              padding: "6px 14px", borderRadius: 8,
                              border: `1px solid ${BORDER}`,
                              background: "transparent",
                              color: "var(--text-body)",
                              fontSize: 12, fontWeight: 600,
                              cursor: rowBusy ? "not-allowed" : "pointer",
                            }}
                          >
                            {tSettings("appointments_cancel")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
                            {formatted}
                          </div>
                          {appt.note && (
                            <div style={{
                              fontSize: 12, color: "var(--text-dim)",
                              marginTop: 2, lineHeight: 1.4,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {appt.note}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setApptEdits((prev) => ({
                              ...prev,
                              [appt.id]: {
                                date: appt.appointmentAt,
                                note: appt.note ?? "",
                              },
                            }))
                          }
                          disabled={apptBusy !== null}
                          aria-label={tSettings("appointments_edit")}
                          style={{
                            padding: "6px 12px", borderRadius: 8,
                            border: `1px solid ${BORDER}`,
                            background: "var(--surface-soft)",
                            color: "var(--text-body)",
                            fontSize: 12, fontWeight: 600,
                            cursor: apptBusy !== null ? "not-allowed" : "pointer",
                            opacity: apptBusy !== null ? 0.5 : 1,
                          }}
                        >
                          {tSettings("appointments_edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAppointmentAction(appt.id)}
                          disabled={apptBusy !== null}
                          aria-label={tSettings("appointments_delete")}
                          style={{
                            padding: "6px 12px", borderRadius: 8,
                            border: `1px solid ${PINK}40`,
                            background: `${PINK}10`,
                            color: PINK,
                            fontSize: 12, fontWeight: 600,
                            cursor: apptBusy !== null ? "not-allowed" : "pointer",
                            opacity: apptBusy !== null ? 0.5 : 1,
                          }}
                        >
                          {rowBusy
                            ? tSettings("save_button_busy")
                            : tSettings("appointments_delete")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {saveError && (
            <div style={{ fontSize: 12, color: PINK, lineHeight: 1.4 }}>{saveError}</div>
          )}
        </div>
      ),
      footer: closeFooter,
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

      <SettingsSection title={tSettings("section_account")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.account}
          label={tSettings("row_account")}
          subtitle={accountEmail || tSettings("account_subtitle_placeholder")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_account") })}
          onClick={() => openSheetWith("account")}
        />
      </SettingsSection>

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
          icon={ICON.glucose}
          label={tSettings("row_target_bg")}
          subtitle={targetBgSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_target_bg") })}
          onClick={() => openSheetWith("targetBg")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.calendar}
          label={tSettings("appointments_title")}
          subtitle={lastAppointmentSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("appointments_title") })}
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
