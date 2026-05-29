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
  fetchTargetRange,
  saveTargetRange,
  saveInsulinSettings,
  DEFAULT_INSULIN_SETTINGS,
  fetchAdjustmentHistory,
  fetchEngineIcrInfo,
  setEngineIcrAutoApply,
  DEFAULT_ENGINE_ICR_INFO,
  type EngineIcrInfo,
  fetchInsulinType,
  saveInsulinType,
  fetchLowAlarmSettingsFromDb,
  saveLowAlarmSettingsToDb,
  type LowAlarmSettingsDb,
} from "@/lib/userSettings";
import {
  getLowAlarmSettings,
  persistLowAlarmSettingsLocally,
} from "@/lib/lowGlucoseAlarm";
import type { InsulinType } from "@/lib/iob";
import type { AdjustmentRecord } from "@/lib/engine/adjustment";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";
import {
  fetchAppointments,
  addAppointment,
  updateAppointment,
  deleteAppointment,
  APPOINTMENT_TAGS,
  tagColor,
  type Appointment,
} from "@/lib/appointments";
import { localeToBcp47 } from "@/lib/time";
import ImportPanel from "@/components/ImportPanel";
import ExportPanel from "@/components/ExportPanel";
import PlanSimulator from "@/components/PlanSimulator";
import CgmSettingsCard from "@/components/CgmSettingsCard";
import NightscoutSettingsCard from "@/components/NightscoutSettingsCard";
import BottomSheet from "@/components/BottomSheet";
import AccountSheet from "@/components/AccountSheet";
import { SettingsSection, SettingsRow, ConnectedDot } from "@/components/SettingsRow";
import { setLocale, readLocaleCookie, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { useTheme } from "@/components/ThemeProvider";
import type { ThemeChoice } from "@/lib/theme";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";
import { useTimeFormat } from "@/hooks/useTimeFormat";
import { isTimeFormatPref } from "@/lib/timeFormat";
import {
  fetchNotificationPrefs,
  saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "@/lib/notificationPrefs";
import {
  fetchCycleLoggingEnabled,
  saveCycleLoggingEnabled,
} from "@/lib/cyclePrefs";
import {
  fetchHapticsEnabled,
  saveHapticsEnabled,
} from "@/lib/hapticsPrefs";
import {
  fetchUserProfile,
  saveUserProfile,
  cycleSurfacesAvailable,
  EMPTY_USER_PROFILE,
  type UserProfile,
  type Sex,
} from "@/lib/userProfile";
import { fetchIcrSchedule } from "@/lib/icrSchedule";
import SnapSlider from "@/components/log/SnapSlider";
import { BASAL_WINDOW_PRESETS, DEFAULT_BASAL_WINDOW_H } from "@/lib/engine/constants";
import { useFeatureFlag } from "@/lib/featureFlags";
import UpgradeGate from "@/components/UpgradeGate";
import { usePlan } from "@/hooks/usePlan";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#FF2D78", PURPLE = "#A78BFA";
const BORDER = "var(--border)";

/** Sub-Header innerhalb einer SettingsSection — markiert eine Unter-
 *  gruppe (z. B. „Parameter", „Bolus-Insulin") visuell mit einer
 *  oberen Trennlinie und einer kleinen Caps-Beschriftung. Wird in der
 *  zusammengeklappten Insulin-Sektion benutzt. */
function SubgroupLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "10px 14px 6px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
        borderTop: `1px solid ${BORDER}`,
        background: "transparent",
      }}
    >
      {label}
    </div>
  );
}

const BOLUS_BRAND_PRESETS: Array<{ name: string; mfr: string; ultraRapid: boolean }> = [
  { name: "NovoRapid", mfr: "Novo Nordisk", ultraRapid: false },
  { name: "Fiasp",     mfr: "Novo Nordisk", ultraRapid: true  },
  { name: "Humalog",   mfr: "Eli Lilly",    ultraRapid: false },
  { name: "Lyumjev",   mfr: "Eli Lilly",    ultraRapid: true  },
  { name: "Apidra",    mfr: "Sanofi",       ultraRapid: false },
];

interface Settings {
  targetMin: number;
  targetMax: number;
  icr: number;
  cf: number;
  /** Target BG for the dose recommender (mg/dL). Mirrors
   *  `user_settings.target_bg_mgdl` so the sync `getInsulinSettings()`
   *  caller stays in lock-step with the DB source of truth. */
  targetBg: number;
  /** Duration of insulin action (minutes). Mirrors `user_settings.dia_minutes`.
   *  `undefined` = user has not explicitly set a value; IOB calculations fall
   *  back to the insulin-type default (rapid 180 / regular 300). */
  diaMinutes?: number;
  /** User's primary bolus insulin brand (e.g. "NovoRapid"). Empty string = not set. */
  insulinBrandBolus: string;
  /** Optional secondary bolus insulin brand. Empty string = not set. */
  insulinBrandBolus2: string;
  /** User's basal insulin brand (e.g. "Tresiba"). Empty string = not set. */
  insulinBrandBasal: string;
  /** User-configured basal insulin action window (hours). Mirrors
   *  `user_settings.basal_action_window_h`. `undefined` = not set; IOBCard
   *  falls back to DEFAULT_BASAL_WINDOW_H (24h). Valid range 12–72. */
  basalActionWindowH?: number;
}

const DEFAULTS: Settings = {
  targetMin: 70,
  targetMax: 180,
  icr: DEFAULT_INSULIN_SETTINGS.icr,
  cf: DEFAULT_INSULIN_SETTINGS.cf,
  targetBg: DEFAULT_INSULIN_SETTINGS.targetBg,
  // diaMinutes intentionally omitted — undefined = use type-based default
  insulinBrandBolus: "",
  insulinBrandBolus2: "",
  insulinBrandBasal: "",
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
  | "targetRange"
  | "units"
  | "icr"
  | "cf"
  | "targetBg"
  | "dia"
  | "insulinBrandBolus"
  | "insulinBrandBolus2"
  | "insulinBrandBasal"
  | "basalWindow"
  | "lastAppointment"
  | "libre2"
  | "nightscout"
  | "dexcom"
  | "notifications"
  | "language"
  | "timeFormat"
  | "carbUnit"
  | "export"
  | "appearance"
  | "macros"
  | "import"
  | "historical"
  | "googleSheets"
  | "onboarding"
  | "adjustmentHistory"
  | "cycleLogging"
  | "aboutMe"
  | "insulinType"
  | "lowAlarm";

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

function PushDebugSection() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [perm, setPerm] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [isNative, setIsNative] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [waitingSecs, setWaitingSecs] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waitRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => {
    setToken(localStorage.getItem("glev_push_token"));
    setError(localStorage.getItem("glev_push_error"));
    setStep(localStorage.getItem("glev_push_step"));
    setPerm(localStorage.getItem("glev_push_perm"));
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (waitRef.current) { clearInterval(waitRef.current); waitRef.current = null; }
  };

  useEffect(() => {
    refresh();
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
    setIsNative(!!w.Capacitor?.isNativePlatform?.());
    setPlatform(w.Capacitor?.getPlatform?.() ?? "web");

    // Listen for the token-arrival event dispatched by persistToken() —
    // this fires immediately when the APNs registration event comes back,
    // even if it takes several seconds after register() was called.
    const onToken = () => { refresh(); stopPolling(); setRetrying(false); setWaitingSecs(0); };
    window.addEventListener("glev:push-token", onToken);
    return () => {
      window.removeEventListener("glev:push-token", onToken);
      stopPolling();
    };
  }, []);

  const handleRetry = async () => {
    stopPolling();
    setRetrying(true);
    setWaitingSecs(0);
    localStorage.removeItem("glev_push_error");
    localStorage.removeItem("glev_push_token");
    localStorage.removeItem("glev_push_step");
    localStorage.removeItem("glev_push_perm");
    refresh();

    const { resetPushInit, initPushNotifications } = await import("@/lib/pushNotifications");
    resetPushInit();
    await initPushNotifications();

    // Poll localStorage every 500 ms for up to 15 s so we catch tokens
    // that arrive after the initial await (APNs can take 3–8 s on iOS).
    let elapsed = 0;
    pollRef.current = setInterval(() => {
      refresh();
      elapsed += 500;
      const tok = localStorage.getItem("glev_push_token");
      const err = localStorage.getItem("glev_push_error");
      if (tok || err || elapsed >= 15000) {
        stopPolling();
        setRetrying(false);
        setWaitingSecs(0);
      }
    }, 500);

    // Tick counter so the user sees "Warte … 3s" instead of a frozen button.
    waitRef.current = setInterval(() => setWaitingSecs(s => s + 1), 1000);
  };

  const stuckAtRegister = retrying && waitingSecs >= 4 &&
    !localStorage.getItem("glev_push_token") &&
    !localStorage.getItem("glev_push_error");

  const bg = token ? "rgba(80,255,120,0.08)" : error ? "rgba(255,80,80,0.08)" : "rgba(120,120,120,0.08)";
  const border = token ? "rgba(80,255,120,0.3)" : error ? "rgba(255,80,80,0.3)" : "rgba(120,120,120,0.2)";

  return (
    <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 12, background: bg, border: `1px solid ${border}`, fontSize: 12, color: "var(--fg)", wordBreak: "break-all" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Push-Debug</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div>🖥 Platform: <strong>{platform ?? "?"}</strong> {isNative ? "(native ✓)" : "(web — push no-op)"}</div>
        <div>🔑 Permission: <strong>{perm ?? "—"}</strong></div>
        <div>📍 Letzter Schritt: <strong>{step ?? "—"}</strong>
          {retrying && waitingSecs > 0 && <span style={{ color: "var(--text-faint)", marginLeft: 6 }}>({waitingSecs}s)</span>}
        </div>
        {token
          ? <div>✅ Token: {token.slice(0, 20)}…</div>
          : <div>⏳ Kein Token</div>
        }
        {error && <div style={{ color: "var(--red, #f87171)", marginTop: 2 }}>❌ {error}</div>}
      </div>

      {perm === "denied" && (
        <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(255,80,80,0.12)", fontSize: 11, lineHeight: 1.4 }}>
          ⚠️ Benachrichtigungen in iOS-Einstellungen abgelehnt.<br />
          Geh zu <strong>Einstellungen → Glev → Mitteilungen</strong> und schalte sie manuell ein.
        </div>
      )}

      {stuckAtRegister && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,180,0,0.10)", border: "1px solid rgba(255,180,0,0.3)", fontSize: 11, lineHeight: 1.5 }}>
          ⏳ <strong>register() wurde aufgerufen — warte auf APNs-Antwort…</strong><br />
          Wenn das nach 15 s hängen bleibt, prüfe in Xcode:<br />
          <strong>Target → Signing &amp; Capabilities → Push Notifications</strong> muss als Capability eingetragen sein.<br />
          Danach neuen Build via <code>fastlane ios beta</code> deployen.
        </div>
      )}

      <button
        onClick={() => void handleRetry()}
        disabled={retrying}
        style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12, cursor: retrying ? "default" : "pointer", opacity: retrying ? 0.6 : 1 }}
      >
        {retrying ? `Warte auf APNs… (${waitingSecs}s)` : "Push-Registrierung neu starten"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tFoodHistory = useTranslations("foodHistory");
  const router = useRouter();
  const aiVoiceEnabled = useFeatureFlag("ai_voice");
  const { canAccess } = usePlan();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  // Tracks whether the user has manually touched any insulin field
  // (icr / cf / targetBg) before the async `fetchInsulinSettings` round
  // trip resolves. Without this gate the late DB-load callback would
  // race with — and clobber — an in-flight edit, e.g. opening the ICR
  // sheet right after navigation, typing 12, hitting Save, but having
  // the fetched 15 land between the keystroke and the save handler
  // reading from state. See Task #40 e2e regression for details.
  const insulinTouchedRef = useRef(false);
  // Same guard for the other DB-loaded sections (Task #137). A user who
  // opens a sheet quickly after navigation and edits before the fetch
  // resolves would see their typed/toggled value disappear once the slow
  // fetch lands. Per-section refs mirror the insulinTouchedRef pattern.
  const macrosTouchedRef = useRef(false);
  const notifTouchedRef = useRef(false);
  // Appointments use the same guard: the sheet open already marks
  // interaction intent (any add/edit/delete commits synchronously to the
  // DB and then applies an optimistic update, which the late fetch would
  // otherwise overwrite with the stale list).
  const apptsTouchedRef = useRef(false);
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
  // Time-format pref (auto / 24h / 12h). DB-backed via profiles.time_format.
  const timeFormat = useTimeFormat();
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  // Opt-in cycle-logging shortcut (gated row in the header "+" menu).
  // DB-backed via `user_settings.cycle_logging_enabled`. Default false
  // — has to be explicitly enabled here before it shows up.
  const [cycleLoggingEnabled, setCycleLoggingEnabled] = useState(false);
  // Haptic feedback toggle — DB-backed via `user_settings.haptics_enabled`.
  // Default true; localStorage mirror keeps the synchronous gate in
  // lib/haptics.ts in sync without requiring an async DB call on every tap.
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  // Personal info (sex / birth_year / height_cm / weight_kg) collected
  // at onboarding. `sex` gates the cycle-logging row below: male users
  // never see it. The "About me" sheet exposes these for editing.
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  // ICR-schedule summary (Matildav request, Phase A) — drives the
  // "ICR-Zeitfenster" row subtitle so it reflects real saved state.
  // Shape: { enabled, activeSlots } where activeSlots = count of slots
  // with enabled=true. Null until first fetch completes.
  const [icrScheduleSummary, setIcrScheduleSummary] = useState<{ enabled: boolean; activeSlots: number } | null>(null);
  // Sheet drafts for the About-me edit form. Live alongside `userProfile`
  // so cancelling the sheet (backdrop / ESC) doesn't clobber the saved
  // values — the SaveFooter calls saveAboutMe() which reads these.
  const [aboutSexDraft, setAboutSexDraft] = useState<Sex | null>(null);
  const [aboutBirthYearDraft, setAboutBirthYearDraft] = useState<string>("");
  const [aboutHeightDraft, setAboutHeightDraft] = useState<string>("");
  const [aboutWeightDraft, setAboutWeightDraft] = useState<string>("");
  // Notification preferences (DB-backed via user_settings.notif_*). Phase 1
  // ships the prefs surface; Phase 2 (web push + cron sender) will start
  // honouring `criticalAlerts` and `quietStart/End`.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [lowAlarmEnabled, setLowAlarmEnabled] = useState(true);
  const [lowAlarmThreshold, setLowAlarmThreshold] = useState(70);
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
  const [apptEdits, setApptEdits] = useState<Record<string, { date: string; note: string; tags: string[]; a1c: string; egfr: string }>>({});
  // Draft state for the "add new appointment" form at the top of the
  // sheet. Defaults to today so the common "I just got back from a
  // visit" flow is one click; the user can pick another date if they
  // want to record an older one.
  const [newApptDate, setNewApptDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [newApptNote, setNewApptNote] = useState<string>("");
  const [newApptTags, setNewApptTags] = useState<string[]>([]);
  const [newApptA1c, setNewApptA1c] = useState<string>("");
  const [newApptEgfr, setNewApptEgfr] = useState<string>("");
  // Distinguish in-flight save from idle. Only enables a single
  // pending op at a time (add OR edit OR delete) — multiple
  // concurrent writes against the same row would race the optimistic
  // local-state update and could leave the list out of sync.
  const [apptBusy, setApptBusy] = useState<string | null>(null);
  const uiLocale = useLocale();
  const bcp47 = localeToBcp47(uiLocale);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [clampNotice, setClampNotice] = useState<string | null>(null);
  // Tracks whether the user typed a value outside a SnapSlider's [min, max]
  // during the current sheet session. Set by each slider's onRawChange
  // callback; consumed (and cleared) by saveInsulinAction. Stored as a ref
  // so it survives renders without triggering re-renders on every keystroke.
  const pendingClampRef = useRef<{ notice: string } | null>(null);

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
  // Effective plan — fetched from /api/me/plan once on mount. Used to gate
  // Glev+-only features like the "Direkter Draht zum Gründer" section.
  const [plan, setPlan] = useState<EffectivePlan>("free");
  // Engine adjustment audit history. The full list lives in
  // `user_settings.adjustment_history` (JSONB); we surface only the
  // most recent ~10 entries on the row subtitle / sheet so the user
  // can see what the engine has been changing without us paginating.
  // Failures collapse to an empty array — same UI as "nothing yet".
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentRecord[]>([]);
  const [insulinType, setInsulinType] = useState<InsulinType>('rapid');
  // Engine-computed ICR info (Lucas-Spec May 14). Surfaced in the ICR
  // sheet as a read-only suggestion line "Engine-Vorschlag: 1:X · …
  // Mahlzeiten" plus an opt-in toggle that lets the engine auto-apply
  // its value once it has 10+ meals of data. Defaults to the zero
  // state (no value, no samples, auto-apply off) so the suggestion
  // line is hidden until the engine has actually computed something.
  const [engineIcrInfo, setEngineIcrInfo] = useState<EngineIcrInfo>(DEFAULT_ENGINE_ICR_INFO);
  // Independent in-flight flag for the auto-apply toggle so flipping
  // it doesn't grey out the whole sheet's Save button — the toggle
  // commits straight to the DB without going through SaveFooter.
  const [autoApplyBusy, setAutoApplyBusy] = useState(false);


  // Insulin-Einstellungen — alle insulinbezogenen Rows (ICR, CF, Ziel-BG,
  // DIA, Insulintyp, Bolus-/Basal-Marken, Basal-Wirkdauer, Engine-Verlauf)
  // sind hinter einer „übergeordneten" Row zusammengefasst. Tap auf den
  // Header klappt die Gruppe auf/zu; die einzelnen Rows behalten ihre
  // bestehenden BottomSheets unverändert. Default: zugeklappt, damit die
  // Settings-Liste insgesamt aufgeräumter wirkt. Persistiert NICHT — wir
  // wollen Frischeintritte gezielt mit Default-Zustand begrüßen.
  const [insulinExpanded, setInsulinExpanded] = useState(false);

  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  // Account-Sheet aus dem Header — geteilte Komponente, deshalb
  // separater State neben `openSheet` (das die Settings-internen
  // BottomSheets steuert). Sowohl die Header-Avatar-Pille als auch
  // die "Konto"-Reihe in den Settings öffnen jetzt dieses Sheet,
  // damit „was du im Header siehst" = „was du in den Settings siehst".
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
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
    fetchMacroTargets()
      .then((m) => { if (!macrosTouchedRef.current) setMacroTargets(m); })
      .catch(() => {})
      .finally(() => { macrosTouchedRef.current = false; });
    fetchNotificationPrefs()
      .then((p) => { if (!notifTouchedRef.current) setNotifPrefs(p); })
      .catch(() => {})
      .finally(() => { notifTouchedRef.current = false; });
    fetchLowAlarmSettingsFromDb().then((s) => {
      setLowAlarmEnabled(s.enabled);
      setLowAlarmThreshold(s.thresholdMgdl);
      persistLowAlarmSettingsLocally(s);
    }).catch(() => {});
    fetchCycleLoggingEnabled().then(setCycleLoggingEnabled).catch(() => {});
    fetchHapticsEnabled().then(setHapticsEnabled).catch(() => {});
    fetchUserProfile().then(setUserProfile).catch(() => {});
    fetchIcrSchedule()
      .then((s) => setIcrScheduleSummary({
        enabled: s.enabled,
        activeSlots: s.slots.filter((slot) => slot.enabled).length,
      }))
      .catch(() => {});
    // Insulin parameters (ICR / CF / target BG) live in `user_settings`
    // — the DB row is the source of truth. We merge it into the local
    // Settings state so the row subtitles reflect the real saved
    // values on first paint, and also write the merged values back to
    // localStorage so the sync `getInsulinSettings()` mirror stays in
    // lock-step. The saved targetMin/targetMax range is not touched
    // here because it isn't yet DB-backed.
    // Personal TIR target range — lives in user_settings.target_min_mgdl
    // / target_max_mgdl (Migration 20260517). Mirror the DB value into
    // local state + localStorage so every TIR card across the app
    // (Insights, Today's Summary, Trend Breakdown, PDF report) pulls
    // the same band the user configured here.
    fetchTargetRange()
      .then((range) => {
        if (insulinTouchedRef.current) return;
        setSettings((prev) => {
          const next = { ...prev, targetMin: range.low, targetMax: range.high };
          saveSettings(next);
          return next;
        });
      })
      .catch(() => {});
    fetchInsulinSettings()
      .then((ins) => {
        // Bail out if the user has already started editing — they would
        // see their typed value silently snap back to the fetched one.
        if (insulinTouchedRef.current) return;
        setSettings((prev) => {
          const next = {
            ...prev,
            icr: ins.icr, cf: ins.cf, targetBg: ins.targetBg, diaMinutes: ins.diaMinutes,
            insulinBrandBolus:  ins.insulinBrandBolus  ?? prev.insulinBrandBolus,
            insulinBrandBolus2: ins.insulinBrandBolus2 ?? prev.insulinBrandBolus2,
            insulinBrandBasal:  ins.insulinBrandBasal  ?? prev.insulinBrandBasal,
            basalActionWindowH: ins.basalActionWindowH ?? prev.basalActionWindowH,
          };
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
    fetchAppointments()
      .then((a) => { if (!apptsTouchedRef.current) setAppointments(a); })
      .catch(() => {})
      .finally(() => { apptsTouchedRef.current = false; });
    // Engine adjustment history — read-only audit trail surfaced under
    // the Insulin section. Newest-first, capped to ~10 for display.
    // `fetchAdjustmentHistory` already returns newest-first, so just
    // take the first 10 — slicing the tail would surface the OLDEST
    // entries on long-lived accounts.
    fetchAdjustmentHistory()
      .then((rows) => setAdjustmentHistory(rows.slice(0, 10)))
      .catch(() => {});
    // Engine ICR + auto-apply preference. Failure → zero state, which
    // hides the suggestion line and shows the toggle as off.
    fetchEngineIcrInfo().then(setEngineIcrInfo).catch(() => {});
    fetchInsulinType().then(setInsulinType).catch(() => {});
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
    // Plan fetch — uses the same /api/me/plan endpoint as AccountSheet
    // so the gate is driven by the same server-side logic (manual_plan_override
    // → profiles.plan → subscription_status → free). Failure leaves plan
    // at the "free" default so the Glev+ section simply stays hidden.
    fetch("/api/me/plan", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { plan: "free" })
      .then((j: { plan?: EffectivePlan }) => {
        if (!cancelled && j.plan) setPlan(j.plan);
      })
      .catch(() => {});
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

  // Deep-link from /onboarding step 5 (CGM-Setup picker). The
  // onboarding flow appends ?cgmSetup=librelinkup|nightscout|
  // apple_health and we auto-open the matching sheet so the user
  // lands directly inside the relevant connect form. We strip the
  // param off the URL so a refresh doesn't re-open the sheet.
  // Apple Health lives inside the libre2 sheet (CgmSettingsCard
  // renders the AH section there on iOS), hence the shared key.
  const cgmSetupHandledRef = useRef(false);
  useEffect(() => {
    if (cgmSetupHandledRef.current) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const setup = url.searchParams.get("cgmSetup");
    if (!setup) return;
    cgmSetupHandledRef.current = true;
    const sheet: SheetKey | null =
      setup === "librelinkup"  ? "libre2"     :
      setup === "apple_health" ? "libre2"     :
      setup === "nightscout"   ? "nightscout" :
      null;
    url.searchParams.delete("cgmSetup");
    window.history.replaceState({}, "", url.toString());
    if (sheet) {
      // Defer so openSheetWith is fully wired (it captures the
      // current draft snapshot from state at call time).
      setTimeout(() => openSheetWith(sheet), 0);
    }
  // openSheetWith is intentionally not a dep — we only want this to
  // fire once on mount per page load, guarded by the ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Mark appointments as user-touched when the sheet opens so the
    // in-flight fetchAppointments() can't overwrite an optimistic
    // add/edit/delete the user triggers before the fetch resolves
    // (Task #137 — same race as insulin/macros/notif sections).
    if (id === "lastAppointment") apptsTouchedRef.current = true;
    // Reset the appointment-sheet's transient draft state every time a
    // sheet opens — even non-appointment sheets — so the user always
    // sees the "add" form pre-filled to today and any abandoned inline
    // edit from a previous open is discarded.
    setApptEdits({});
    setNewApptDate(new Date().toISOString().slice(0, 10));
    setNewApptNote("");
    setNewApptTags([]);
    setNewApptA1c("");
    setNewApptEgfr("");
    setApptBusy(null);
    setSaveError("");
    // Seed About-me drafts from the canonical profile so the sheet
    // opens pre-filled with whatever's currently saved. We always seed
    // (even for non-aboutMe sheets) — cheap, and avoids a stale draft
    // sneaking in if the user opens the sheet a second time after a
    // background fetchUserProfile() refresh.
    setUserProfile((curProfile) => {
      setAboutSexDraft(curProfile.sex);
      setAboutBirthYearDraft(curProfile.birthYear ? String(curProfile.birthYear) : "");
      setAboutHeightDraft(curProfile.heightCm ? String(curProfile.heightCm) : "");
      setAboutWeightDraft(curProfile.weightKg ? String(curProfile.weightKg) : "");
      return curProfile;
    });
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
    setClampNotice(null);
    pendingClampRef.current = null;
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
        // ICR is now NUMERIC(5,1) in the DB (Migration 20260515) — round
        // to one decimal so 8.5 survives the round-trip but 8.547 is
        // sanitised. CF + target BG remain integer columns.
        icr:        Math.min(30, Math.max(5, Math.round(settings.icr * 10) / 10)),
        cf:         Math.min(500, Math.max(1, Math.round(settings.cf))),
        targetBg:   Math.min(200, Math.max(60, Math.round(settings.targetBg))),
        // diaMinutes is optional — pass undefined when the user has never
        // set it so saveInsulinSettings() preserves the DB NULL and the
        // IOB path continues to use the insulin-type fallback.
        ...(settings.diaMinutes !== undefined
          ? { diaMinutes: Math.min(360, Math.max(60, Math.round(settings.diaMinutes))) }
          : {}),
      };

      await saveInsulinSettings(clamped);
      // Persist the TIR target range alongside the insulin params so
      // every TIR card across the app (Insights, Today's Summary,
      // Trend Breakdown, PDF) sees the same band on the next read.
      // Defensive clamp matches the migration's CHECK constraints
      // (each bound 40–250, spread ≥ 20).
      try {
        const rangeLow  = Math.min(250, Math.max(40, Math.round(settings.targetMin)));
        const rangeHigh = Math.min(250, Math.max(rangeLow + 20, Math.round(settings.targetMax)));
        await saveTargetRange({ low: rangeLow, high: rangeHigh });
      } catch (rangeErr) {
        // Non-fatal: the insulin save already succeeded. We surface
        // the range failure as a soft console.warn rather than a
        // hard error so the user still sees their ICR/CF/targetBg
        // change land.
        // eslint-disable-next-line no-console
        console.warn("[glev] saveTargetRange failed:", rangeErr instanceof Error ? rangeErr.message : rangeErr);
      }
      // Mirror the clamped values back into local state + localStorage
      // so the sync `getInsulinSettings()` caller (engine evaluation
      // path) and the row subtitles see exactly what we just wrote.
      const next = { ...settings, ...clamped };
      setSettings(next);
      saveSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      setDraftSnapshot(null);
      // Surface the clamp notice (set by onRawChange callbacks in each
      // SnapSlider when the user types a value outside [min, max]).
      // Keep the sheet open so the user can read the notice before
      // dismissing manually. Return true (close) only when in-range.
      const clamp = pendingClampRef.current;
      pendingClampRef.current = null;
      setClampNotice(clamp ? clamp.notice : null);
      return !clamp;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings, tSettings]);

  /** Persist the TIR target range (user_settings.target_min_mgdl /
   *  target_max_mgdl, Migration 20260517). Clamp matches the
   *  migration's CHECK constraints (each bound 40–250, spread ≥ 20)
   *  so a Postgres rejection only fires for a truly malformed write,
   *  then mirror the clamped values into local state + localStorage
   *  so the sync `getTargetRange()` consumers (Dashboard Trend
   *  Breakdown, CurrentDayGlucoseCard, Insights initial paint) see
   *  exactly what we just wrote. */
  const saveTargetRangeAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      const rangeLow  = Math.min(250, Math.max(40, Math.round(settings.targetMin)));
      const rangeHigh = Math.min(250, Math.max(rangeLow + 20, Math.round(settings.targetMax)));
      await saveTargetRange({ low: rangeLow, high: rangeHigh });
      const next = { ...settings, targetMin: rangeLow, targetMax: rangeHigh };
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

  const saveLowAlarmAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      const clamped: LowAlarmSettingsDb = {
        enabled: lowAlarmEnabled,
        thresholdMgdl: Math.min(90, Math.max(40, Math.round(lowAlarmThreshold))),
      };
      await saveLowAlarmSettingsToDb(clamped);
      persistLowAlarmSettingsLocally(clamped);
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
  }, [lowAlarmEnabled, lowAlarmThreshold, tSettings]);

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
      const parsedA1c = newApptA1c !== "" ? parseFloat(newApptA1c) : null;
      const parsedEgfr = newApptEgfr !== "" ? parseFloat(newApptEgfr) : null;
      const inserted = await addAppointment(
        newApptDate,
        newApptNote,
        newApptTags,
        parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null,
        parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null,
      );
      setAppointments((prev) =>
        [inserted, ...prev].sort(
          (a, b) => b.appointmentAt.localeCompare(a.appointmentAt),
        ),
      );
      // Reset the form so a quick "log another" flow stays fluid.
      setNewApptDate(new Date().toISOString().slice(0, 10));
      setNewApptNote("");
      setNewApptTags([]);
      setNewApptA1c("");
      setNewApptEgfr("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
    } finally {
      setApptBusy(null);
    }
  }, [newApptDate, newApptNote, newApptTags, newApptA1c, newApptEgfr, tSettings]);

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
        const parsedA1c = draft.a1c !== "" ? parseFloat(draft.a1c) : null;
        const parsedEgfr = draft.egfr !== "" ? parseFloat(draft.egfr) : null;
        await updateAppointment(
          id,
          draft.date,
          draft.note,
          draft.tags,
          parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null,
          parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null,
        );
        setAppointments((prev) =>
          prev
            .map((a) =>
              a.id === id
                ? {
                    ...a,
                    appointmentAt: draft.date,
                    note: draft.note.trim() === "" ? null : draft.note.trim(),
                    tags: draft.tags,
                    a1c: parsedA1c !== null && !isNaN(parsedA1c) ? parsedA1c : null,
                    egfr: parsedEgfr !== null && !isNaN(parsedEgfr) ? parsedEgfr : null,
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
    // Mark notif prefs as user-touched so in-flight fetchNotificationPrefs
    // doesn't race in and overwrite a toggled value (Task #137).
    notifTouchedRef.current = true;
    setNotifPrefs((prev) => ({ ...prev, [key]: val }));
  }

  /** Toggle haptic feedback. Optimistic — flips local state + localStorage
   *  mirror immediately (so haptics.ts reacts on the very next tap), then
   *  persists to DB. Reverts on error. */
  const toggleHapticsEnabled = useCallback(async (next: boolean) => {
    const prev = hapticsEnabled;
    setHapticsEnabled(next);
    setSaveError("");
    try {
      await saveHapticsEnabled(next);
    } catch (e) {
      setHapticsEnabled(prev);
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
    }
  }, [hapticsEnabled, tSettings]);

  /** Toggle the cycle-logging opt-in. Optimistic — flips local state
   *  immediately so the switch animates, then persists. On DB error we
   *  revert so the UI never lies about the saved value. */
  const toggleCycleLogging = useCallback(async (next: boolean) => {
    const prev = cycleLoggingEnabled;
    setCycleLoggingEnabled(next);
    setSaveError("");
    try {
      await saveCycleLoggingEnabled(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setCycleLoggingEnabled(prev);
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
    }
  }, [cycleLoggingEnabled, tSettings]);

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
    if (key === "icr" || key === "cf" || key === "targetBg" || key === "diaMinutes") {
      insulinTouchedRef.current = true;
    }
    setSettings((prev) => ({ ...prev, [key]: val }));
  }

  function updMacro<K extends keyof MacroTargets>(key: K, val: MacroTargets[K]) {
    // Mark macros as user-touched so in-flight fetchMacroTargets doesn't
    // race in and overwrite the typed value (Task #137 — mirrors insulinTouchedRef).
    macrosTouchedRef.current = true;
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
    cycle: <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" /></svg>,
    support: <svg {...iconProps}><path d="M21 12a9 9 0 1 1-3.5-7.1L21 3v6h-6" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>,
    feedback: <svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
    sparkle: <svg {...iconProps}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>,
  };

  /* ── subtitles derived from current state ──────────────────────── */
  const targetRangeSub = tSettings("subtitle_target_range", { min: settings.targetMin, max: settings.targetMax });
  const icrSub = tSettings("subtitle_icr", { value: settings.icr });
  const cfSub = tSettings("subtitle_cf", { value: settings.cf });
  const targetBgSub = tSettings("subtitle_target_bg", { value: settings.targetBg });
  const diaSub = settings.diaMinutes != null
    ? tSettings("subtitle_dia", { minutes: settings.diaMinutes })
    : tSettings("subtitle_dia_unset");
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
  // Subtitle for the Zeitformat row — mirrors the user's pref so the
  // row at-a-glance shows whether they're on auto, 24h, or 12h.
  const timeFormatSub = (
    timeFormat.pref === "24h" ? tSettings("subtitle_time_format_24h") :
    timeFormat.pref === "12h" ? tSettings("subtitle_time_format_12h") :
    tSettings("subtitle_time_format_auto")
  );
  const notifSub = notifPrefs.criticalAlerts
    ? tSettings("subtitle_notif_on", { from: notifPrefs.quietStart, to: notifPrefs.quietEnd })
    : tSettings("subtitle_notif_off");
  const cycleLoggingSub = cycleLoggingEnabled
    ? tSettings("subtitle_cycle_logging_on")
    : tSettings("subtitle_cycle_logging_off");
  // Cycle-logging Settings row is hidden entirely for male users. Female
  // / diverse / null (legacy users without a saved sex) all see it.
  const cycleRowVisible = cycleSurfacesAvailable(userProfile.sex);
  const aboutMeSub = (() => {
    const parts: string[] = [];
    if (userProfile.sex === "female") parts.push(tSettings("about_me_sex_female"));
    else if (userProfile.sex === "male") parts.push(tSettings("about_me_sex_male"));
    else if (userProfile.sex === "diverse") parts.push(tSettings("about_me_sex_diverse"));
    if (userProfile.birthYear) {
      const age = new Date().getFullYear() - userProfile.birthYear;
      parts.push(tSettings("about_me_age", { age }));
    }
    return parts.length > 0 ? parts.join(" · ") : tSettings("about_me_unset");
  })();

  /** Save the About-me sheet drafts. Validates client-side; the API and
   *  DB CHECK constraints are the final gate. Returns true on success
   *  so the SaveFooter dismisses the sheet. */
  const saveAboutMe = useCallback(async (): Promise<boolean> => {
    setSaveError("");
    if (aboutSexDraft === null) {
      setSaveError(tSettings("about_me_sex_required"));
      return false;
    }
    const birthYearNum = parseInt(aboutBirthYearDraft, 10);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(birthYearNum) || birthYearNum < 1900 || birthYearNum > currentYear) {
      setSaveError(tSettings("about_me_birth_year_invalid", { min: 1900, max: currentYear }));
      return false;
    }
    const heightNum = aboutHeightDraft.trim() === "" ? null : parseInt(aboutHeightDraft, 10);
    if (heightNum !== null && (!Number.isInteger(heightNum) || heightNum < 50 || heightNum > 280)) {
      setSaveError(tSettings("about_me_height_invalid"));
      return false;
    }
    const weightNum = aboutWeightDraft.trim() === ""
      ? null
      : parseFloat(aboutWeightDraft.replace(",", "."));
    if (weightNum !== null && (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400)) {
      setSaveError(tSettings("about_me_weight_invalid"));
      return false;
    }

    setSaving(true);
    try {
      await saveUserProfile({
        sex: aboutSexDraft,
        birthYear: birthYearNum,
        heightCm: heightNum,
        weightKg: weightNum,
      });
      setUserProfile({
        sex: aboutSexDraft,
        birthYear: birthYearNum,
        heightCm: heightNum,
        weightKg: weightNum,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [aboutSexDraft, aboutBirthYearDraft, aboutHeightDraft, aboutWeightDraft, tSettings]);

  const saveInsulinTypeAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await saveInsulinType(insulinType);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [insulinType, tSettings]);

  /** Persist insulin brand names to user_settings and mirror into localStorage. */
  const saveInsulinBrandsAction = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      await saveInsulinSettings({
        icr:      Math.min(30, Math.max(5, Math.round(settings.icr * 10) / 10)),
        cf:       Math.min(500, Math.max(1, Math.round(settings.cf))),
        targetBg: Math.min(200, Math.max(60, Math.round(settings.targetBg))),
        ...(settings.diaMinutes !== undefined
          ? { diaMinutes: Math.min(360, Math.max(60, Math.round(settings.diaMinutes))) }
          : {}),
        insulinBrandBolus:  settings.insulinBrandBolus.trim().slice(0, 40)  || undefined,
        insulinBrandBolus2: settings.insulinBrandBolus2.trim().slice(0, 40) || undefined,
        insulinBrandBasal:  settings.insulinBrandBasal.trim().slice(0, 40)  || undefined,
        ...(settings.basalActionWindowH !== undefined
          ? { basalActionWindowH: Math.min(72, Math.max(12, Math.round(settings.basalActionWindowH))) }
          : {}),
      });
      const next = { ...settings };
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

  /* ── shared sheet footers ──────────────────────────────────────── */
  /** Save footer: button calls `onSave()`; sheet only dismisses on a true
   * return so an inline error keeps the user's in-progress values visible. */
  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {clampNotice && (
          <div
            data-testid="clamp-notice"
            style={{
              fontSize: 13,
              color: "var(--text-dim)",
              lineHeight: 1.45,
              textAlign: "center",
              padding: "8px 12px",
              background: "var(--surface-soft)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {clampNotice}
          </div>
        )}
        {saveError && (
          <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>
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
            background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "var(--on-accent)",
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
        color: "var(--text-strong)", fontSize: 14, fontWeight: 600, cursor: "pointer",
      }}
    >
      {tSettings("sheet_close")}
    </button>
  );

  /* ── sheet content blocks ──────────────────────────────────────── */
  const sheetContent: Record<SheetKey, { title: string; body: ReactNode; footer?: ReactNode }> = {
    lowAlarm: {
      title: tSettings("sheet_low_alarm_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 16, margin: "0 0 16px" }}>
            {tSettings("low_alarm_hint")}
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 0" }}>
            <span style={{ fontSize: 14, color: "var(--text-strong)", fontWeight: 500 }}>
              {tSettings("low_alarm_enabled_label")}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={lowAlarmEnabled}
              onClick={() => setLowAlarmEnabled((v) => !v)}
              style={{
                width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
                background: lowAlarmEnabled ? ACCENT : "var(--surface-raised)",
                position: "relative", transition: "background 0.2s", flexShrink: 0,
              }}
            >
              <span style={{
                position: "absolute", top: 3, width: 20, height: 20, borderRadius: "50%",
                background: "white",
                left: lowAlarmEnabled ? 21 : 3,
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>
          </div>
          {lowAlarmEnabled && (
            <>
              <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 8 }}>
                {tSettings("low_alarm_threshold_label")}
              </p>
              <SnapSlider
                value={lowAlarmThreshold}
                onChange={(v) => setLowAlarmThreshold(v)}
                min={40}
                max={90}
                step={1}
                unit="mg/dL"
                accent={ACCENT}
                ariaLabel={tSettings("low_alarm_threshold_label")}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingLeft: 2, paddingRight: 2 }}>
                {[40, 50, 60, 70, 80, 90].map((tick) => (
                  <span key={tick} style={{
                    fontSize: 10,
                    color: lowAlarmThreshold === tick ? ACCENT : "var(--text-ghost)",
                    fontWeight: lowAlarmThreshold === tick ? 700 : 400,
                  }}>{tick}</span>
                ))}
              </div>
            </>
          )}
        </div>
      ),
      footer: <SaveFooter onSave={saveLowAlarmAction} />,
    },
    targetRange: {
      title: tSettings("row_target_range"),
      body: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("target_min")}</label>
            <input style={inp} type="number" value={settings.targetMin} onChange={(e) => upd("targetMin", parseInt(e.target.value) || 70)} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{tSettings("target_max")}</label>
            <input style={inp} type="number" value={settings.targetMax} onChange={(e) => upd("targetMax", parseInt(e.target.value) || 180)} />
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveTargetRangeAction} />,
    },
    units: {
      title: tSettings("sheet_units_title"),
      body: (
        <p style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>
          {tSettings("sheet_units_body")}
        </p>
      ),
      footer: closeFooter,
    },
    icr: {
      title: tSettings("insulin_to_carb_ratio"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
            {tSettings("icr_label")}
          </p>
          <SnapSlider
            value={settings.icr ?? 10}
            onChange={(v) => upd("icr", v)}
            onRawChange={(raw) => {
              const clamped = Math.max(5, Math.min(30, raw));
              pendingClampRef.current = Math.abs(clamped - raw) > 0.001
                ? { notice: tSettings("clamp_notice", { value: `${clamped} g/IE`, min: 5, max: 30 }) }
                : null;
            }}
            min={5}
            max={30}
            step={1}
            unit="g/IE"
            accent={ACCENT}
            ariaLabel={tSettings("insulin_to_carb_ratio")}
          />
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            paddingLeft: 2,
            paddingRight: 2,
          }}>
            {[5, 10, 15, 20, 25, 30].map((tick) => (
              <span key={tick} style={{
                fontSize: 10,
                color: (settings.icr ?? 10) === tick ? ACCENT : "var(--text-ghost)",
                fontWeight: (settings.icr ?? 10) === tick ? 700 : 400,
                transition: "color 150ms ease",
              }}>
                {tick}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{tSettings("icr_hint")}</div>

          {/* Engine-Vorschlag (Lucas-Spec May 14): read-only line under
              the input that surfaces the engine-computed ICR + how many
              meals fed it. Hidden until the engine has actually computed
              a value (sampleSize > 0) so brand-new users don't see an
              empty placeholder. Pure display — the toggle below is what
              actually controls whether the engine writes anything. */}
          {engineIcrInfo.value != null && engineIcrInfo.sampleSize > 0 ? (
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--surface-soft)",
              border: `1px solid var(--border-soft)`,
              borderRadius: 10,
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.5,
            }}>
              {tSettings("icr_engine_suggestion", {
                value: Math.round(engineIcrInfo.value * 10) / 10,
                n: engineIcrInfo.sampleSize,
              })}
            </div>
          ) : engineIcrInfo.sampleSize > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
              {tSettings("icr_engine_warming_up", { n: engineIcrInfo.sampleSize })}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>
              {tSettings("icr_engine_no_data_yet")}
            </div>
          )}

          {/* Auto-apply toggle — opt-in. Default off so existing users
              see no behaviour change. When on, the engine writes its
              value into icr_g_per_unit (and appends to adjustment_history)
              once sampleSize >= 10. Commits directly to the DB on tap so
              the user gets immediate feedback; rollback on error. */}
          <label style={{
            marginTop: 14,
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 14px",
            background: "var(--surface-soft)",
            border: `1px solid var(--border)`,
            borderRadius: 12,
            cursor: autoApplyBusy ? "wait" : "pointer",
            opacity: autoApplyBusy ? 0.6 : 1,
          }}>
            <input
              type="checkbox"
              checked={engineIcrInfo.autoApply}
              disabled={autoApplyBusy}
              onChange={async (e) => {
                const next = e.target.checked;
                // Optimistic flip so the UI feels instant; revert on
                // DB error so the toggle never lies about what's saved.
                setEngineIcrInfo((p) => ({ ...p, autoApply: next }));
                setAutoApplyBusy(true);
                try {
                  await setEngineIcrAutoApply(next);
                } catch {
                  setEngineIcrInfo((p) => ({ ...p, autoApply: !next }));
                  setSaveError(tSettings("save_failed"));
                } finally {
                  setAutoApplyBusy(false);
                }
              }}
              style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, cursor: "inherit" }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                {tSettings("icr_auto_apply_label")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.5 }}>
                {tSettings("icr_auto_apply_hint")}
              </div>
            </div>
          </label>
          {/* Matildav Phase A — link to the per-time-window editor.
              Lives INSIDE the ICR sheet so users find it where they
              expect (under "Insulin-Carb-Verhältnis"), not as a sibling
              row in the Insulin section. */}
          <button
            type="button"
            onClick={() => { setOpenSheet(null); router.push("/settings/icr-schedule"); }}
            style={{
              marginTop: 18,
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              background: "var(--surface-soft)",
              border: `1px solid var(--border)`,
              borderRadius: 12,
              cursor: "pointer",
              textAlign: "left",
            }}
            aria-label={tSettings("row_open_aria", { label: tSettings("row_icr_schedule") })}
          >
            <div style={{ flex: 1, paddingRight: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                {tSettings("row_icr_schedule")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                {icrScheduleSummary?.enabled && icrScheduleSummary.activeSlots > 0
                  ? tSettings("subtitle_icr_schedule_on", { n: icrScheduleSummary.activeSlots })
                  : tSettings("subtitle_icr_schedule_off")}
              </div>
            </div>
            <span style={{ fontSize: 18, color: "var(--text-ghost)" }}>›</span>
          </button>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    cf: {
      title: tSettings("correction_factor"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
            {tSettings("cf_label")}
          </p>
          <SnapSlider
            value={settings.cf ?? 50}
            onChange={(v) => upd("cf", v)}
            onRawChange={(raw) => {
              const clamped = Math.max(10, Math.min(100, raw));
              pendingClampRef.current = clamped !== raw
                ? { notice: tSettings("clamp_notice", { value: `${clamped} mg/dL/IE`, min: 10, max: 100 }) }
                : null;
            }}
            min={10}
            max={100}
            step={1}
            unit="mg/dL/IE"
            accent={ACCENT}
            ariaLabel={tSettings("correction_factor")}
          />
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            paddingLeft: 2,
            paddingRight: 2,
          }}>
            {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((tick) => (
              <span key={tick} style={{
                fontSize: 10,
                color: (settings.cf ?? 50) === tick ? ACCENT : "var(--text-ghost)",
                fontWeight: (settings.cf ?? 50) === tick ? 700 : 400,
                transition: "color 150ms ease",
              }}>
                {tick}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{tSettings("cf_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    targetBg: {
      title: tSettings("row_target_bg"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
            {tSettings("target_bg_label")}
          </p>
          <SnapSlider
            value={settings.targetBg ?? 100}
            onChange={(v) => upd("targetBg", v)}
            onRawChange={(raw) => {
              const clamped = Math.max(60, Math.min(200, raw));
              pendingClampRef.current = clamped !== raw
                ? { notice: tSettings("clamp_notice", { value: `${clamped} mg/dL`, min: 60, max: 200 }) }
                : null;
            }}
            min={60}
            max={200}
            step={5}
            unit="mg/dL"
            accent={ACCENT}
            ariaLabel={tSettings("row_target_bg")}
          />
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            paddingLeft: 2,
            paddingRight: 2,
          }}>
            {[80, 100, 120, 140, 160, 180].map((tick) => (
              <span key={tick} style={{
                fontSize: 10,
                color: (settings.targetBg ?? 100) === tick ? ACCENT : "var(--text-ghost)",
                fontWeight: (settings.targetBg ?? 100) === tick ? 700 : 400,
                transition: "color 150ms ease",
              }}>
                {tick}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{tSettings("target_bg_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    dia: {
      title: tSettings("sheet_dia_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
            {tSettings("sheet_dia_body")}
          </p>
          <SnapSlider
            value={settings.diaMinutes ?? 180}
            onChange={(v) => upd("diaMinutes", v)}
            onRawChange={(raw) => {
              const clamped = Math.max(60, Math.min(360, raw));
              pendingClampRef.current = clamped !== raw
                ? { notice: tSettings("clamp_notice", { value: `${clamped} min`, min: 60, max: 360 }) }
                : null;
            }}
            min={60}
            max={360}
            step={30}
            unit="min"
            accent={ACCENT}
            ariaLabel={tSettings("sheet_dia_label")}
          />
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            paddingLeft: 2,
            paddingRight: 2,
          }}>
            {[60, 120, 180, 240, 300, 360].map((tick) => (
              <span key={tick} style={{
                fontSize: 10,
                color: (settings.diaMinutes ?? 180) === tick ? ACCENT : "var(--text-ghost)",
                fontWeight: (settings.diaMinutes ?? 180) === tick ? 700 : 400,
                transition: "color 150ms ease",
              }}>
                {tick}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 8 }}>{tSettings("sheet_dia_hint")}</div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinAction} />,
    },
    insulinBrandBolus: {
      title: tSettings("sheet_insulin_brand_bolus_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
            {tSettings("insulin_brand_body")}
          </p>
          {/* Preset brand cards — same visual language as the Insulintyp picker */}
          {BOLUS_BRAND_PRESETS.map((preset) => {
            const isSel = settings.insulinBrandBolus === preset.name;
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => upd("insulinBrandBolus", preset.name)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  border: `2px solid ${isSel ? ACCENT : BORDER}`,
                  background: isSel ? `${ACCENT}14` : "var(--surface-soft)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 3,
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: isSel ? ACCENT : "var(--text-strong)" }}>
                  {preset.name}
                </div>
                <div style={{ fontSize: 12, color: isSel ? ACCENT : "var(--text-faint)" }}>
                  {preset.mfr} · {preset.ultraRapid
                    ? tSettings("insulin_brand_preset_ultra_rapid")
                    : tSettings("insulin_type_rapid_label")}
                </div>
              </button>
            );
          })}
          {/* Manual override — always visible so niche brands aren't excluded */}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
              {tSettings("insulin_brand_or_manual")}
            </label>
            <input
              style={inp}
              type="text"
              maxLength={40}
              placeholder={tSettings("insulin_brand_bolus_placeholder")}
              value={settings.insulinBrandBolus}
              onChange={(e) => upd("insulinBrandBolus", e.target.value.slice(0, 40))}
            />
            <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>
              {tSettings("insulin_brand_hint")}
            </div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    insulinBrandBolus2: {
      title: tSettings("sheet_insulin_brand_bolus_2_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
            {tSettings("insulin_brand_bolus_2_body")}
          </p>
          {BOLUS_BRAND_PRESETS.map((preset) => {
            const isSel = settings.insulinBrandBolus2 === preset.name;
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => upd("insulinBrandBolus2", preset.name)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  border: `2px solid ${isSel ? ACCENT : BORDER}`,
                  background: isSel ? `${ACCENT}14` : "var(--surface-soft)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", flexDirection: "column", gap: 3,
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: isSel ? ACCENT : "var(--text-strong)" }}>
                  {preset.name}
                </div>
                <div style={{ fontSize: 12, color: isSel ? ACCENT : "var(--text-faint)" }}>
                  {preset.mfr} · {preset.ultraRapid
                    ? tSettings("insulin_brand_preset_ultra_rapid")
                    : tSettings("insulin_type_rapid_label")}
                </div>
              </button>
            );
          })}
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
              {tSettings("insulin_brand_or_manual")}
            </label>
            <input
              style={inp}
              type="text"
              maxLength={40}
              placeholder={tSettings("insulin_brand_bolus_2_placeholder")}
              value={settings.insulinBrandBolus2}
              onChange={(e) => upd("insulinBrandBolus2", e.target.value.slice(0, 40))}
            />
            <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>
              {tSettings("insulin_brand_hint")}
            </div>
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    insulinBrandBasal: {
      title: tSettings("sheet_insulin_brand_basal_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
            {tSettings("insulin_brand_body")}
          </p>
          <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
            {tSettings("row_insulin_brand_basal")}
          </label>
          <input
            style={inp}
            type="text"
            maxLength={40}
            placeholder={tSettings("insulin_brand_basal_placeholder")}
            value={settings.insulinBrandBasal}
            onChange={(e) => upd("insulinBrandBasal", e.target.value.slice(0, 40))}
          />
          <div style={{ fontSize: 13, color: "var(--text-ghost)", marginTop: 6 }}>
            {tSettings("insulin_brand_hint")}
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
    },
    basalWindow: {
      title: tSettings("sheet_basal_window_title"),
      body: (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 14 }}>
            {tSettings("basal_window_body")}
          </p>
          <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 8 }}>
            {tSettings("basal_window_preset_label")}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {Object.entries(BASAL_WINDOW_PRESETS).map(([brand, hours]) => {
              const isSel = settings.basalActionWindowH === hours;
              return (
                <button
                  key={brand}
                  type="button"
                  onClick={() => upd("basalActionWindowH", hours)}
                  style={{
                    background: isSel ? ACCENT : "var(--surface-soft)",
                    color: isSel ? "var(--on-accent)" : "var(--text)",
                    border: `1px solid ${isSel ? ACCENT : BORDER}`,
                    borderRadius: 999,
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: isSel ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  {brand} · {hours} h
                </button>
              );
            })}
          </div>
          <SnapSlider
            min={12}
            max={72}
            step={2}
            unit="h"
            accent={ACCENT}
            value={settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H}
            onChange={(v) => upd("basalActionWindowH", v)}
          />
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 11, color: "var(--text-ghost)", marginTop: 6, padding: "0 4px",
          }}>
            {[12, 24, 36, 48, 60, 72].map(tick => (
              <span key={tick} style={{
                color: (settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H) === tick ? ACCENT : "var(--text-ghost)",
                fontWeight: (settings.basalActionWindowH ?? DEFAULT_BASAL_WINDOW_H) === tick ? 700 : 400,
              }}>{tick}</span>
            ))}
          </div>
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinBrandsAction} />,
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
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("appointments_hint")}
          </div>

          {/* Add form — date, note, tags, and optional lab values. */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 10,
            padding: "12px 14px", borderRadius: 12,
            background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>
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
                disabled={apptBusy !== null || !newApptDate}
                maxLength={200}
              />
            </div>
            {/* Tag picker */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {tSettings("appointments_tags_label")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {APPOINTMENT_TAGS.map((tag) => {
                  const selected = newApptTags.includes(tag);
                  const color = tagColor(tag);
                  const tagKey = `appointments_tag_${tag.toLowerCase()}` as Parameters<typeof tSettings>[0];
                  return (
                    <button
                      key={tag}
                      type="button"
                      disabled={apptBusy !== null}
                      onClick={() =>
                        setNewApptTags((prev) =>
                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                        )
                      }
                      style={{
                        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                        border: `1px solid ${selected ? color : BORDER}`,
                        background: selected ? `${color}20` : "transparent",
                        color: selected ? color : "var(--text-dim)",
                        cursor: apptBusy !== null ? "not-allowed" : "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {tSettings(tagKey)}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Optional lab values */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {tSettings("appointments_lab_values_title")}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                  <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                    {tSettings("appointments_a1c_label")}
                  </label>
                  <input
                    style={{ ...inp }}
                    type="number"
                    min="2" max="20" step="0.1"
                    value={newApptA1c}
                    placeholder={tSettings("appointments_a1c_placeholder")}
                    onChange={(e) => setNewApptA1c(e.target.value)}
                    disabled={apptBusy !== null}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                  <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                    {tSettings("appointments_egfr_label")}
                  </label>
                  <input
                    style={{ ...inp }}
                    type="number"
                    min="0" max="200" step="1"
                    value={newApptEgfr}
                    placeholder={tSettings("appointments_egfr_placeholder")}
                    onChange={(e) => setNewApptEgfr(e.target.value)}
                    disabled={apptBusy !== null}
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={addAppointmentAction}
              disabled={apptBusy !== null || !newApptDate}
              style={{
                alignSelf: "flex-start",
                padding: "8px 16px", borderRadius: 9, border: "none",
                background: `${ACCENT}`, color: "var(--on-accent)",
                fontSize: 13, fontWeight: 700,
                cursor: apptBusy !== null || !newApptDate ? "not-allowed" : "pointer",
                opacity: apptBusy !== null || !newApptDate ? 0.6 : 1,
              }}
            >
              {apptBusy === "__add__"
                ? tSettings("appointments_add_busy")
                : tSettings("appointments_add_button")}
            </button>
          </div>

          {/* List of saved appointments. */}
          {appointments.length === 0 ? (
            <div style={{
              padding: "16px 14px", borderRadius: 12,
              border: `1px dashed ${BORDER}`,
              fontSize: 13, color: "var(--text-faint)",
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
                        {/* Edit: tag picker */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {tSettings("appointments_tags_label")}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {APPOINTMENT_TAGS.map((tag) => {
                              const selected = editing.tags.includes(tag);
                              const color = tagColor(tag);
                              const tagKey = `appointments_tag_${tag.toLowerCase()}` as Parameters<typeof tSettings>[0];
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  disabled={rowBusy}
                                  onClick={() =>
                                    setApptEdits((prev) => ({
                                      ...prev,
                                      [appt.id]: {
                                        ...editing,
                                        tags: editing.tags.includes(tag)
                                          ? editing.tags.filter((t) => t !== tag)
                                          : [...editing.tags, tag],
                                      },
                                    }))
                                  }
                                  style={{
                                    padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                                    border: `1px solid ${selected ? color : BORDER}`,
                                    background: selected ? `${color}20` : "transparent",
                                    color: selected ? color : "var(--text-dim)",
                                    cursor: rowBusy ? "not-allowed" : "pointer",
                                    transition: "all 0.15s",
                                  }}
                                >
                                  {tSettings(tagKey)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {/* Edit: lab values */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {tSettings("appointments_lab_values_title")}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                              <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                                {tSettings("appointments_a1c_label")}
                              </label>
                              <input
                                style={{ ...inp }}
                                type="number"
                                min="2" max="20" step="0.1"
                                value={editing.a1c}
                                placeholder={tSettings("appointments_a1c_placeholder")}
                                onChange={(e) =>
                                  setApptEdits((prev) => ({
                                    ...prev,
                                    [appt.id]: { ...editing, a1c: e.target.value },
                                  }))
                                }
                                disabled={rowBusy}
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 100px" }}>
                              <label style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>
                                {tSettings("appointments_egfr_label")}
                              </label>
                              <input
                                style={{ ...inp }}
                                type="number"
                                min="0" max="200" step="1"
                                value={editing.egfr}
                                placeholder={tSettings("appointments_egfr_placeholder")}
                                onChange={(e) =>
                                  setApptEdits((prev) => ({
                                    ...prev,
                                    [appt.id]: { ...editing, egfr: e.target.value },
                                  }))
                                }
                                disabled={rowBusy}
                              />
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => updateAppointmentAction(appt.id)}
                            disabled={rowBusy}
                            style={{
                              padding: "6px 14px", borderRadius: 8, border: "none",
                              background: ACCENT, color: "var(--on-accent)",
                              fontSize: 13, fontWeight: 600,
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
                              fontSize: 13, fontWeight: 600,
                              cursor: rowBusy ? "not-allowed" : "pointer",
                            }}
                          >
                            {tSettings("appointments_cancel")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
                              {formatted}
                            </div>
                            {/* Tag badges */}
                            {appt.tags.length > 0 && appt.tags.map((tag) => (
                              <span
                                key={tag}
                                style={{
                                  padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                                  background: `${tagColor(tag)}20`,
                                  color: tagColor(tag),
                                  border: `1px solid ${tagColor(tag)}40`,
                                  letterSpacing: "0.02em",
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          {appt.note && (
                            <div style={{
                              fontSize: 13, color: "var(--text-dim)",
                              marginTop: 2, lineHeight: 1.4,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {appt.note}
                            </div>
                          )}
                          {/* Lab values row */}
                          {(appt.a1c !== null || appt.egfr !== null) && (
                            <div style={{
                              display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap",
                            }}>
                              {appt.a1c !== null && (
                                <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>
                                  HbA1c <strong style={{ color: "var(--text-strong)" }}>{appt.a1c}%</strong>
                                </span>
                              )}
                              {appt.egfr !== null && (
                                <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>
                                  eGFR <strong style={{ color: "var(--text-strong)" }}>{appt.egfr}</strong>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() =>
                              setApptEdits((prev) => ({
                                ...prev,
                                [appt.id]: {
                                  date: appt.appointmentAt,
                                  note: appt.note ?? "",
                                  tags: appt.tags,
                                  a1c: appt.a1c !== null ? String(appt.a1c) : "",
                                  egfr: appt.egfr !== null ? String(appt.egfr) : "",
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
                              fontSize: 13, fontWeight: 600,
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
                              fontSize: 13, fontWeight: 600,
                              cursor: apptBusy !== null ? "not-allowed" : "pointer",
                              opacity: apptBusy !== null ? 0.5 : 1,
                            }}
                          >
                            {rowBusy
                              ? tSettings("save_button_busy")
                              : tSettings("appointments_delete")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {saveError && (
            <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4 }}>{saveError}</div>
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
        <p style={{ fontSize: 14, color: "var(--text-body)", lineHeight: 1.55, margin: 0 }}>
          {tSettings("sheet_dexcom_body")}
        </p>
      ),
      footer: closeFooter,
    },
    aboutMe: {
      title: tSettings("about_me_sheet_title"),
      body: (() => {
        const inputStyle: React.CSSProperties = {
          ...inp,
          fontSize: 16,
        };
        const labelStyle: React.CSSProperties = {
          fontSize: 12.5, fontWeight: 600, color: "var(--text-faint)",
          textTransform: "uppercase", letterSpacing: "0.04em",
          marginBottom: 6,
        };
        const sexOpts: { key: Sex; label: string }[] = [
          { key: "female",  label: tSettings("about_me_sex_female") },
          { key: "male",    label: tSettings("about_me_sex_male") },
          { key: "diverse", label: tSettings("about_me_sex_diverse") },
        ];
        const currentYear = new Date().getFullYear();
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 13, color: "var(--text-faint)", margin: 0, lineHeight: 1.5 }}>
              {tSettings("about_me_sheet_desc")}
            </p>

            <div>
              <div style={labelStyle}>
                {tSettings("about_me_sex_label")} <span style={{ color: PINK }}>*</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {sexOpts.map((opt) => {
                  const active = aboutSexDraft === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setAboutSexDraft(opt.key)}
                      aria-pressed={active}
                      style={{
                        padding: "12px 8px",
                        borderRadius: 10,
                        border: `1px solid ${active ? ACCENT : BORDER}`,
                        background: active ? `${ACCENT}1F` : "var(--surface-soft)",
                        color: active ? "var(--text-strong)" : "var(--text-body)",
                        fontWeight: active ? 700 : 500,
                        fontSize: 14, fontFamily: "inherit", cursor: "pointer",
                        minHeight: 44,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={labelStyle}>
                {tSettings("about_me_birth_year_label")} <span style={{ color: PINK }}>*</span>
              </div>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                placeholder={String(currentYear - 30)}
                value={aboutBirthYearDraft}
                onChange={(e) => setAboutBirthYearDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={labelStyle}>{tSettings("about_me_height_label")}</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  placeholder="170"
                  value={aboutHeightDraft}
                  onChange={(e) => setAboutHeightDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>{tSettings("about_me_weight_label")}</div>
                <input
                  inputMode="decimal"
                  maxLength={5}
                  placeholder="70"
                  value={aboutWeightDraft}
                  onChange={(e) => setAboutWeightDraft(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))}
                  style={inputStyle}
                />
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--text-faint)", margin: 0, lineHeight: 1.5 }}>
              {tSettings("about_me_optional_hint")}
            </p>
          </div>
        );
      })(),
      footer: <SaveFooter onSave={saveAboutMe} />,
    },
    cycleLogging: {
      title: tSettings("cycle_logging_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "var(--surface-soft)", borderRadius: 10, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{tSettings("cycle_logging_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{tSettings("cycle_logging_desc")}</div>
            </div>
            <div
              role="switch"
              aria-checked={cycleLoggingEnabled}
              aria-label={tSettings("cycle_logging_label")}
              onClick={() => { void toggleCycleLogging(!cycleLoggingEnabled); }}
              style={{
                width: 44, height: 24, borderRadius: 99, cursor: "pointer", flexShrink: 0,
                background: cycleLoggingEnabled ? PINK : "var(--border-strong)",
                border: `1px solid ${cycleLoggingEnabled ? PINK + "60" : BORDER}`,
                position: "relative", transition: "background 0.2s",
              }}
            >
              <div style={{ position: "absolute", top: 2, left: cycleLoggingEnabled ? 22 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
          </div>
          {saveError && (
            <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4 }}>{saveError}</div>
          )}
        </div>
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
              <div style={{ fontSize: 14, fontWeight: 500 }}>{tSettings("notif_critical_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{tSettings("notif_critical_desc")}</div>
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
              <div style={{ fontSize: 14, fontWeight: 500 }}>{tSettings("notif_smart_label")}</div>
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 2 }}>{tSettings("notif_smart_soon")}</div>
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
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{tSettings("notif_quiet_label")}</div>
            <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 10 }}>{tSettings("notif_quiet_desc")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-body)" }}>{tSettings("notif_quiet_from")}</span>
              <input
                type="time"
                value={notifPrefs.quietStart}
                onChange={(e) => updNotif("quietStart", e.target.value)}
                style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 14 }}
              />
              <span style={{ fontSize: 13, color: "var(--text-body)" }}>{tSettings("notif_quiet_to")}</span>
              <input
                type="time"
                value={notifPrefs.quietEnd}
                onChange={(e) => updNotif("quietEnd", e.target.value)}
                style={{ ...inp, width: "auto", padding: "6px 10px", fontSize: 14 }}
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
                color: pendingLocale ? "var(--on-accent)" : "var(--text-faint)",
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
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {tSettings("language_confirm_body")}
            </div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
    timeFormat: {
      title: tSettings("time_format_card_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <select
            value={timeFormat.pref}
            onChange={(e) => {
              const next = e.target.value;
              if (isTimeFormatPref(next)) timeFormat.setPref(next);
            }}
            style={{
              padding: "12px 14px", borderRadius: 10,
              border: `1px solid ${BORDER}`, background: "var(--surface)",
              color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer",
              appearance: "none", WebkitAppearance: "none",
              backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M2 4l4 4 4-4z'/></svg>\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 14px center",
              paddingRight: 36,
            }}
          >
            <option value="auto">{tSettings("time_format_opt_auto")}</option>
            <option value="24h">{tSettings("time_format_opt_24h")}</option>
            <option value="12h">{tSettings("time_format_opt_12h")}</option>
          </select>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("time_format_hint")}
          </div>
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
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {tSettings("appearance_hint")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.5 }}>
            {tSettings("appearance_app_only_hint")}
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
                    color: active ? "var(--on-accent)" : "var(--text-body)",
                    fontSize: 14, fontWeight: active ? 600 : 500,
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
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
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
                    color: active ? "var(--on-accent)" : "var(--text-body)",
                    fontSize: 14, fontWeight: active ? 600 : 500,
                    transition: "background 120ms ease, color 120ms ease",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
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
          <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
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
                <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>{target.label}</label>
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
          <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55 }}>
            {tSettings("historical_intro")}
          </div>
          <button
            onClick={handleReloadHistorical}
            disabled={reloading}
            style={{
              padding: "12px 18px", borderRadius: 10, border: `1px solid ${ACCENT}40`,
              cursor: reloading ? "wait" : "pointer",
              background: `${ACCENT}15`, color: ACCENT, fontSize: 14, fontWeight: 600,
              opacity: reloading ? 0.6 : 1,
            }}
          >
            {reloading ? tSettings("historical_loading") : tSettings("historical_reload")}
          </button>
          {reloadMsg && (
            <div style={{ fontSize: 13, color: reloadMsg.kind === "error" ? PINK : GREEN }}>{reloadMsg.text}</div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
    onboarding: {
      // Replays the 4-step intro flow. POSTs `action: "reset"` to
      // clear `profiles.onboarding_completed_at`, then hard-redirects
      // to /onboarding so the protected-layout gate picks up the
      // null state. Confirm dialog is intentional — Lucas chose
      // "Skip = endgültig durch" in the gate-design discussion, so
      // replay is opt-in and shouldn't fire by accident.
      title: tSettings("onboarding_replay_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.55 }}>
            {tSettings("onboarding_replay_desc")}
          </div>
          <button
            onClick={async () => {
              if (!window.confirm(tSettings("onboarding_replay_confirm"))) return;
              try {
                const res = await fetch("/api/onboarding", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "reset" }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                window.location.href = "/onboarding";
              } catch {
                window.alert(tSettings("onboarding_replay_error"));
              }
            }}
            style={{
              alignSelf: "flex-start",
              padding: "12px 22px",
              borderRadius: 12,
              border: "none",
              background: ACCENT,
              color: "var(--on-accent)",
              fontWeight: 700,
              fontSize: 14,
              fontFamily: "inherit",
              cursor: "pointer",
              boxShadow: `0 4px 14px ${ACCENT}55`,
            }}
          >
            {tSettings("onboarding_replay_btn")}
          </button>
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
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {tSettings("google_sheets_desc")}
              </div>
            </div>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
              background: "var(--surface)", color: "var(--text-dim)",
              border: `1px solid ${BORDER}`, letterSpacing: "0.08em", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              {tSettings("coming_soon")}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.55 }}>
            {tSettings("google_sheets_footnote")}
          </div>
        </div>
      ),
      footer: closeFooter,
    },
    adjustmentHistory: {
      title: tSettings("adjustment_history_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.5, margin: 0 }}>
            {tSettings("adjustment_history_intro")}
          </p>
          {adjustmentHistory.length === 0 ? (
            <div style={{
              padding: "14px 16px", borderRadius: 12,
              background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
              fontSize: 14, color: "var(--text-faint)",
            }}>
              {tSettings("adjustment_history_empty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {adjustmentHistory.map((rec, idx) => {
                const date = parseDbDate(rec.at).toLocaleDateString(bcp47, {
                  year: "numeric", month: "short", day: "numeric",
                });
                const fieldLabel = rec.field === "icr"
                  ? tSettings("adjustment_field_icr")
                  : tSettings("adjustment_field_cf");
                return (
                  <div
                    key={`${rec.at}-${idx}`}
                    style={{
                      padding: "10px 12px", borderRadius: 10,
                      background: "var(--surface-soft)", border: `1px solid ${BORDER}`,
                      display: "flex", flexDirection: "column", gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
                      {tSettings("adjustment_history_row", {
                        date,
                        field: fieldLabel,
                        from: rec.from,
                        to: rec.to,
                      })}
                    </div>
                    {rec.reason && (
                      <div style={{ fontSize: 13, color: "var(--text-faint)" }}>
                        {rec.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ),
      footer: closeFooter,
    },
    insulinType: {
      title: tSettings("sheet_insulin_type_title"),
      body: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(["rapid", "regular"] as const).map((type) => {
            const isSelected = insulinType === type;
            const label = type === "rapid"
              ? tSettings("insulin_type_rapid_label")
              : tSettings("insulin_type_regular_label");
            const examples = type === "rapid"
              ? tSettings("insulin_type_rapid_examples")
              : tSettings("insulin_type_regular_examples");
            const dia = type === "rapid"
              ? tSettings("insulin_type_rapid_dia")
              : tSettings("insulin_type_regular_dia");
            return (
              <button
                key={type}
                type="button"
                onClick={() => setInsulinType(type)}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: `2px solid ${isSelected ? ACCENT : BORDER}`,
                  background: isSelected ? `${ACCENT}14` : "var(--surface-soft)",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: isSelected ? ACCENT : "var(--text-strong)" }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{examples}</div>
                <div style={{ fontSize: 12, color: isSelected ? ACCENT : "var(--text-faint)", marginTop: 2 }}>{dia}</div>
              </button>
            );
          })}
        </div>
      ),
      footer: <SaveFooter onSave={saveInsulinTypeAction} />,
    },
  };

  const active = openSheet ? sheetContent[openSheet] : null;
  const adjustmentHistorySub = adjustmentHistory.length === 0
    ? tSettings("subtitle_adjustment_history_empty")
    : tSettings("subtitle_adjustment_history_count", { n: adjustmentHistory.length });


  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* 2026-05-17 round 7: page-title bottom margin trimmed 24 → 16
          to match the new equal-on-all-sides rhythm (see comment in
          components/SettingsRow.tsx → SettingsSection). */}
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
          {tSettings("page_title")}
        </h1>
        <p style={{ color: "var(--text-faint)", fontSize: 14 }}>{tSettings("page_subtitle")}</p>
      </div>

      {/* ── Cluster: Konto ──────────────────────────────────────────── */}

      <SettingsSection title={tSettings("section_account")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.account}
          label={tSettings("row_account")}
          subtitle={accountEmail || tSettings("account_subtitle_placeholder")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_account") })}
          onClick={() => setAccountSheetOpen(true)}
        />
        <SettingsRow
          iconColor={PURPLE}
          icon={
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          }
          label={tSettings("about_me_row_label")}
          subtitle={aboutMeSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("about_me_row_label") })}
          onClick={() => openSheetWith("aboutMe")}
        />
      </SettingsSection>

      {/* Glev AI & Glev+ im Konto-Tab (nur wenn sichtbar) */}
      {aiVoiceEnabled && (
        <SettingsSection title={tSettings("section_glev_ai")}>
          <SettingsRow
            first
            iconColor={ACCENT}
            icon={ICON.sparkle}
            label={tSettings("section_glev_ai")}
            subtitle={tSettings("ai_settings_row_subtitle")}
            ariaLabel={tSettings("section_glev_ai")}
            onClick={() => router.push("/settings/ai")}
          />
        </SettingsSection>
      )}

      {plan === "plus" && (
        <SettingsSection title={tSettings("section_glev_plus")}>
          <SettingsRow
            first
            iconColor={PURPLE}
            icon={ICON.sparkle}
            label={tSettings("row_founder_contact")}
            subtitle={tSettings("subtitle_founder_contact")}
            ariaLabel={tSettings("row_open_aria", { label: tSettings("row_founder_contact") })}
            onClick={() => window.open("mailto:lucas@glev.app", "_blank", "noopener,noreferrer")}
          />
        </SettingsSection>
      )}

      {/* ── Glukose ───────────────────────────────────────────────── */}
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
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          }
          label={tSettings("row_low_alarm")}
          subtitle={
            lowAlarmEnabled
              ? tSettings("subtitle_low_alarm_on", { threshold: lowAlarmThreshold })
              : tSettings("subtitle_low_alarm_off")
          }
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_low_alarm") })}
          onClick={() => openSheetWith("lowAlarm")}
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

      {/* Termine gehört thematisch zu Glukose/Gesundheit */}
      <SettingsSection title={tSettings("section_appointments")}>
        <SettingsRow
          first
          iconColor={ACCENT}
          icon={ICON.calendar}
          label={tSettings("appointments_title")}
          subtitle={lastAppointmentSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("appointments_title") })}
          onClick={canAccess("doctor_appointment_tracker") ? () => openSheetWith("lastAppointment") : () => {}}
          rightAdornment={<UpgradeGate feature="doctor_appointment_tracker" variant="row" />}
        />
      </SettingsSection>

      {/* ── Insulin ───────────────────────────────────────────────── */}
      <SettingsSection title={tSettings("section_insulin")}>
        {/* Übergeordnete „Insulin-Einstellungen"-Row — klappt die 9
            insulin-bezogenen Rows auf/zu. Eigene Button-Markup statt
            SettingsRow, damit wir den Chevron drehen + aria-expanded
            steuern können. Optisch lehnt sich das Layout aber an
            SettingsRow an (Icon-Tile + zwei Textzeilen + 14px Padding). */}
        <button
          type="button"
          onClick={() => setInsulinExpanded((v) => !v)}
          aria-expanded={insulinExpanded}
          aria-label={tSettings(insulinExpanded ? "insulin_settings_collapse_aria" : "insulin_settings_expand_aria")}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 14px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            color: "inherit",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: `${ACCENT}18`, color: ACCENT,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {ICON.insulin}
          </span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.25 }}>
              {tSettings("row_insulin_settings")}
            </span>
            <span style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {icrSub}{diaSub ? ` · ${diaSub}` : ""}
            </span>
          </span>
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              color: "var(--text-faint)",
              transform: insulinExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ›
          </span>
        </button>

        {insulinExpanded && (
          <>
            <SubgroupLabel label={tSettings("group_insulin_params")} />
            <SettingsRow
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
              icon={ICON.insulin}
              label={tSettings("row_dia")}
              subtitle={diaSub}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_dia") })}
              onClick={() => openSheetWith("dia")}
            />

            <SubgroupLabel label={tSettings("group_insulin_bolus")} />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_insulin_type")}
              subtitle={insulinType === "rapid"
                ? tSettings("subtitle_insulin_type_rapid")
                : tSettings("subtitle_insulin_type_regular")}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_insulin_type") })}
              onClick={() => openSheetWith("insulinType")}
            />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_insulin_brand_bolus")}
              subtitle={settings.insulinBrandBolus.trim() || tSettings("subtitle_no_brand")}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_insulin_brand_bolus") })}
              onClick={() => openSheetWith("insulinBrandBolus")}
            />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_insulin_brand_bolus_2")}
              subtitle={settings.insulinBrandBolus2.trim() || tSettings("subtitle_no_brand")}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_insulin_brand_bolus_2") })}
              onClick={() => openSheetWith("insulinBrandBolus2")}
            />

            <SubgroupLabel label={tSettings("group_insulin_basal")} />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_insulin_brand_basal")}
              subtitle={settings.insulinBrandBasal.trim() || tSettings("subtitle_no_brand")}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_insulin_brand_basal") })}
              onClick={() => openSheetWith("insulinBrandBasal")}
            />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_basal_window")}
              subtitle={settings.basalActionWindowH !== undefined
                ? tSettings("subtitle_basal_window_h", { h: settings.basalActionWindowH })
                : tSettings("subtitle_basal_window_default")}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_basal_window") })}
              onClick={() => openSheetWith("basalWindow")}
            />

            <SubgroupLabel label={tSettings("group_insulin_history")} />
            <SettingsRow
              iconColor={ACCENT}
              icon={ICON.insulin}
              label={tSettings("row_adjustment_history")}
              subtitle={adjustmentHistorySub}
              ariaLabel={tSettings("row_open_aria", { label: tSettings("row_adjustment_history") })}
              onClick={() => openSheetWith("adjustmentHistory")}
            />
          </>
        )}
      </SettingsSection>

      {/* ── CGM ───────────────────────────────────────────────────── */}
      <SettingsSection title="CGM">
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

      {/* ── App ───────────────────────────────────────────────────── */}
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
          icon={
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h2a5 5 0 0 1 10 0h2" />
              <path d="M5 12a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          }
          label={tSettings("row_haptics_label")}
          subtitle={hapticsEnabled ? tSettings("row_haptics_subtitle_on") : tSettings("row_haptics_subtitle_off")}
          ariaLabel={tSettings("row_haptics_label")}
          onClick={() => void toggleHapticsEnabled(!hapticsEnabled)}
          rightAdornment={
            <div
              role="switch"
              aria-checked={hapticsEnabled}
              style={{
                width: 44, height: 26, borderRadius: 13,
                background: hapticsEnabled ? ACCENT : "var(--border)",
                position: "relative", transition: "background 0.2s ease",
                flexShrink: 0, cursor: "pointer",
              }}
            >
              <div style={{
                position: "absolute", top: 3,
                left: hapticsEnabled ? 21 : 3,
                width: 20, height: 20, borderRadius: "50%",
                background: "white",
                transition: "left 0.2s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
          }
        />
        {cycleRowVisible && (
          <SettingsRow
            iconColor={PINK}
            icon={ICON.cycle}
            label={tSettings("cycle_logging_title")}
            subtitle={cycleLoggingSub}
            ariaLabel={tSettings("row_open_aria", { label: tSettings("cycle_logging_title") })}
            onClick={() => openSheetWith("cycleLogging")}
          />
        )}
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
          icon={ICON.globe}
          label={tSettings("row_time_format")}
          subtitle={timeFormatSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_time_format") })}
          onClick={() => openSheetWith("timeFormat")}
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
          icon={ICON.carbs}
          label={tFoodHistory("page_title")}
          subtitle={tFoodHistory("page_subtitle")}
          ariaLabel={tSettings("row_open_aria", { label: tFoodHistory("page_title") })}
          onClick={() => router.push("/settings/food-history")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.download}
          label={tSettings("row_export")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_export") })}
          onClick={() => openSheetWith("export")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.sheets}
          label={tSettings("onboarding_replay_title")}
          subtitle={tSettings("onboarding_replay_desc")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("onboarding_replay_title") })}
          onClick={() => openSheetWith("onboarding")}
        />
        <SettingsRow
          iconColor={PURPLE}
          icon={ICON.appearance}
          label={tSettings("appearance")}
          subtitle={themeSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("appearance") })}
          onClick={() => openSheetWith("appearance")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.target}
          label={tSettings("daily_macros_title")}
          subtitle={macroSub}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("daily_macros_title") })}
          onClick={() => openSheetWith("macros")}
        />
      </SettingsSection>

      {/* ── Push-Debug (nur auf Gerät sichtbar wenn Token oder Fehler vorhanden) ── */}
      <PushDebugSection />

      {/* ── Mehr ──────────────────────────────────────────────────── */}
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

      {/* ── Hilfe & Support ───────────────────────────────────────── */}
      <SettingsSection title="Hilfe">
        <SettingsRow
          first
          iconColor={PURPLE}
          icon={ICON.feedback}
          label={tSettings("row_feature_requests")}
          subtitle={tSettings("subtitle_feature_requests")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_feature_requests") })}
          onClick={() => window.open("https://glev.featurebase.app/", "_blank", "noopener,noreferrer")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={ICON.support}
          label={tSettings("row_help_cgm_sources")}
          subtitle={tSettings("subtitle_help_cgm_sources")}
          ariaLabel={tSettings("row_open_aria", { label: tSettings("row_help_cgm_sources") })}
          onClick={() => router.push("/settings/help/cgm-quellen")}
        />
      </SettingsSection>

      {/* Plan-Simulator — immer sichtbar (nur für Admin-Account) */}
      <div style={{ marginTop: 32, marginBottom: 8 }}>
        <PlanSimulator />
      </div>

      <p style={{
        marginTop: 16, marginBottom: 8,
        marginLeft: "auto", marginRight: "auto",
        maxWidth: 560, fontSize: 13, lineHeight: 1.55,
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

      {/* Geteiltes Konto-Sheet — identisch zu dem aus dem Header-Avatar.
          Damit sehen Header- und Settings-Klick exakt dasselbe (E-Mail,
          Mitglied seit, Mahlzeiten, Passwort ändern, Upgrade, Abmelden). */}
      <AccountSheet
        open={accountSheetOpen}
        onClose={() => setAccountSheetOpen(false)}
      />
    </div>
  );
}
