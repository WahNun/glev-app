"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import { reloadHistoricalEntries } from "@/lib/meals";
import { fetchMacroTargets, saveMacroTargets, DEFAULT_MACRO_TARGETS, type MacroTargets } from "@/lib/userSettings";
import ImportPanel from "@/components/ImportPanel";
import ExportPanel from "@/components/ExportPanel";
import CgmSettingsCard from "@/components/CgmSettingsCard";
import NightscoutSettingsCard from "@/components/NightscoutSettingsCard";
import BottomSheet from "@/components/BottomSheet";
import { localeToBcp47 } from "@/lib/time";
import { setLocale, readLocaleCookie, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { useTheme } from "@/components/ThemeProvider";
import type { ThemeChoice } from "@/lib/theme";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import type { CarbUnit } from "@/lib/carbUnits";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78";
const SURFACE="var(--surface)", BORDER="var(--border)";

interface Settings {
  targetMin: number;
  targetMax: number;
  icr: number;
  cf: number;
  notifySpike: boolean;
  notifyHypo: boolean;
}

const DEFAULTS: Settings = { targetMin:70, targetMax:180, icr:15, cf:50, notifySpike:true, notifyHypo:true };

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("glev_settings") || "{}") }; }
  catch { return DEFAULTS; }
}

function saveSettings(s: Settings) {
  if (typeof window !== "undefined") localStorage.setItem("glev_settings", JSON.stringify(s));
}

// All sheet IDs in one union so both the row config and the open-state
// stay type-checked together. Adding a new row = extend this union and
// add a matching <BottomSheet> render block at the bottom.
type SheetId =
  | "glucose_targets" | "units"
  | "icr" | "cf"
  | "cgm_librelinkup" | "cgm_nightscout" | "cgm_dexcom"
  | "appearance" | "language" | "carb_unit" | "notifications" | "export"
  | "macros" | "historical" | "google_sheets" | "import";

export default function SettingsPage() {
  const tSettings = useTranslations("settings");
  const tCommon = useTranslations("common");
  const dateLocale = localeToBcp47(useLocale());
  const [settings, setSettings]   = useState<Settings>(DEFAULTS);
  const [saved, setSaved]     = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [currentLocale, setCurrentLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    const fromCookie = readLocaleCookie();
    if (fromCookie) setCurrentLocale(fromCookie);
  }, []);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme();
  // Carb-unit selector (g / BE / KE) — DACH users typically dose in BE
  // (1 BE = 12g) or KE (1 KE = 10g). Optimistic update + persists to
  // profiles.carb_unit; the hook exposes display/conversion helpers used
  // throughout the engine, entries, and insights surfaces.
  const carbUnit = useCarbUnit();
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving]       = useState(false);

  // Currently-open bottom sheet (or null = section list visible only).
  // One-at-a-time semantics — opening a row closes any other open sheet.
  const [openSheet, setOpenSheet] = useState<SheetId | null>(null);
  // Draft snapshot captured the moment a sheet opens. If the user dismisses
  // the sheet via backdrop / ESC / drag-down / Schließen-button, we revert
  // the in-memory state to this snapshot so half-typed values don't leak
  // back into the row subtitles or get committed on the next global save.
  // Successful saves clear this snapshot so the new values become canonical.
  const [draftSnapshot, setDraftSnapshot] = useState<{ settings: Settings; macroTargets: MacroTargets } | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    if (!supabase) return;
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
  }, []);

  function openSheetWith(id: SheetId) {
    // Always snapshot — even info-only sheets do nothing harmful, and
    // tracking branching by id-type would just be ceremony. Snapshot is
    // structural-clone-ish (objects are flat primitives).
    setDraftSnapshot({ settings: { ...settings }, macroTargets: { ...macroTargets } });
    setSaveError("");
    setOpenSheet(id);
  }

  function closeSheet() {
    // Revert any unsaved edits to the snapshot taken at open-time. Also
    // discard a staged locale selection so a backdrop-close on the
    // language sheet doesn't leave a "Save" button armed on next visit.
    if (draftSnapshot) {
      setSettings(draftSnapshot.settings);
      setMacroTargets(draftSnapshot.macroTargets);
      setDraftSnapshot(null);
    }
    setPendingLocale(null);
    setSaveError("");
    setOpenSheet(null);
  }

  // Persist current edits. Returns true on success so the caller (the
  // sheet footer Save button) can decide whether to dismiss or keep the
  // sheet open with the error visible. Throws are converted to false +
  // an inline saveError so the user sees what went wrong without losing
  // their in-progress values.
  async function saveAndKeepOpen(): Promise<boolean> {
    setSaving(true);
    setSaveError("");
    try {
      saveSettings(settings);
      await saveMacroTargets(macroTargets);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Commit: the snapshot is now stale because these values ARE the
      // new baseline, so a subsequent close should not revert.
      setDraftSnapshot(null);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : tSettings("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
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
    setSettings(prev => ({ ...prev, [key]: val }));
  }

  function updMacro<K extends keyof MacroTargets>(key: K, val: MacroTargets[K]) {
    setMacroTargets(prev => ({ ...prev, [key]: val }));
  }

  const inp: React.CSSProperties  = { background:"var(--input-bg)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px", color:"var(--text)", fontSize:14, outline:"none", width:"100%" };

  // Subtitles derived from current state — these show under each row label
  // in the section list so the user sees the active value without opening
  // the sheet. Memoised because they recompute on every render of inputs
  // inside open sheets, which is fine but cheap to skip.
  const themeLabel = useMemo(() => {
    return themeChoice === "dark" ? tSettings("theme_dark")
         : themeChoice === "light" ? tSettings("theme_light")
         : tSettings("theme_system");
  }, [themeChoice, tSettings]);
  const languageLabel = currentLocale === "de" ? "Deutsch" : "English";

  // Each section is rendered as an iOS-style grouped card with a small
  // uppercase header above it. Rows inside are separated by hairlines.
  const SECTIONS: { id: string; label: string; rows: Array<{ id: SheetId; label: string; sub?: string }> }[] = [
    {
      id: "glucose",
      label: tSettings("group_glucose"),
      rows: [
        { id: "glucose_targets", label: tSettings("row_glucose_targets"), sub: `${settings.targetMin} – ${settings.targetMax} mg/dL` },
        { id: "units",           label: tSettings("row_units"),           sub: tSettings("subtitle_unit_mgdl") },
      ],
    },
    {
      id: "insulin",
      label: tSettings("group_insulin"),
      rows: [
        { id: "icr", label: tSettings("row_icr"), sub: `1:${settings.icr}` },
        { id: "cf",  label: tSettings("row_cf"),  sub: `1:${settings.cf}` },
      ],
    },
    {
      id: "cgm",
      label: tSettings("group_cgm"),
      rows: [
        { id: "cgm_librelinkup", label: tSettings("row_cgm_librelinkup") },
        { id: "cgm_nightscout",  label: tSettings("row_cgm_nightscout") },
        { id: "cgm_dexcom",      label: tSettings("row_cgm_dexcom"),     sub: tSettings("subtitle_coming_soon") },
      ],
    },
    {
      id: "app",
      label: tSettings("group_app"),
      rows: [
        { id: "appearance",    label: tSettings("row_appearance"),    sub: themeLabel },
        { id: "language",      label: tSettings("row_language"),      sub: languageLabel },
        { id: "carb_unit",     label: tSettings("row_carb_unit"),     sub: carbUnit.label },
        { id: "notifications", label: tSettings("row_notifications") },
        { id: "export",        label: tSettings("row_export") },
      ],
    },
    {
      id: "advanced",
      label: tSettings("group_advanced"),
      rows: [
        { id: "macros",         label: tSettings("row_macros") },
        { id: "historical",     label: tSettings("row_historical") },
        { id: "google_sheets",  label: tSettings("row_google_sheets"), sub: tSettings("subtitle_coming_soon") },
        { id: "import",         label: tSettings("row_import") },
      ],
    },
  ];

  // Footer used for sheets that contain editable inputs — Save commits via
  // saveAndKeepOpen() and only dismisses the sheet on success. On failure
  // the inline `saveError` strip stays visible above the buttons so the
  // user can read the message without losing their in-progress values.
  // For info-only sheets we render a "Schließen" footer instead.
  const saveFooter = (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {saveError && (
        <div style={{ fontSize:12, color:PINK, lineHeight:1.4 }}>{saveError}</div>
      )}
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={closeSheet} style={{
          flex:"0 0 auto", padding:"12px 18px", borderRadius:12,
          border:`1px solid ${BORDER}`, background:"transparent",
          color:"var(--text-strong)", fontSize:13, fontWeight:600, cursor:"pointer",
        }}>
          {tSettings("sheet_close")}
        </button>
        <button onClick={async () => {
          const ok = await saveAndKeepOpen();
          if (ok) setOpenSheet(null);
        }} disabled={saving} style={{
          flex:1, padding:"12px 16px", borderRadius:12, border:"none",
          cursor: saving ? "wait" : "pointer",
          background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff",
          fontSize:13, fontWeight:700, opacity: saving ? 0.7 : 1,
        }}>
          {saving ? tSettings("save_button_busy") : saved ? tSettings("save_button_done") : tSettings("save_button_idle")}
        </button>
      </div>
    </div>
  );

  const closeFooter = (
    <button onClick={closeSheet} style={{
      width:"100%", padding:"12px 16px", borderRadius:12,
      border:`1px solid ${BORDER}`, background:"var(--surface-soft)",
      color:"var(--text-strong)", fontSize:13, fontWeight:600, cursor:"pointer",
    }}>
      {tSettings("sheet_close")}
    </button>
  );

  return (
    <div style={{ maxWidth:720, margin:"0 auto" }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>{tSettings("page_title")}</h1>
        <p style={{ color:"var(--text-faint)", fontSize:14 }}>{tSettings("page_subtitle")}</p>
      </div>

      {/* iOS-style grouped section list. Each group is a card with uppercase
          header above; rows are stacked with hairline separators between
          them. Tapping any row opens its bottom sheet. */}
      <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
        {SECTIONS.map(section => (
          <section key={section.id}>
            <div style={{
              fontSize:11, fontWeight:700, letterSpacing:"0.1em",
              color:"var(--text-faint)", textTransform:"uppercase",
              padding:"0 16px 8px",
            }}>{section.label}</div>
            <div style={{
              background:SURFACE, border:`1px solid ${BORDER}`,
              borderRadius:14, overflow:"hidden",
            }}>
              {section.rows.map((row, idx) => (
                <button
                  key={row.id}
                  onClick={() => openSheetWith(row.id)}
                  style={{
                    display:"flex", alignItems:"center", gap:12,
                    width:"100%", padding:"14px 16px",
                    background:"transparent", border:"none",
                    borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                    textAlign:"left", cursor:"pointer",
                    color:"var(--text)",
                  }}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:500 }}>{row.label}</div>
                  </div>
                  {row.sub && (
                    <div style={{
                      fontSize:13, color:"var(--text-dim)",
                      maxWidth:"50%",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>{row.sub}</div>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p style={{
        marginTop: 32, marginBottom: 8,
        marginLeft: "auto", marginRight: "auto",
        maxWidth: 560, fontSize: 11, lineHeight: 1.55,
        color: "var(--text-faint)", textAlign: "center",
      }}>
        {tSettings("footer_disclaimer")}
      </p>

      {/* ====================== SHEETS ====================== */}

      {/* GLUCOSE — Zielbereich */}
      <BottomSheet open={openSheet === "glucose_targets"} onClose={closeSheet} title={tSettings("glucose_targets")} footer={saveFooter}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div>
            <label style={{ fontSize:12, color:"var(--text-dim)", display:"block", marginBottom:6 }}>{tSettings("target_min")}</label>
            <input style={inp} type="number" value={settings.targetMin} onChange={e => upd("targetMin", parseInt(e.target.value)||70)}/>
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--text-dim)", display:"block", marginBottom:6 }}>{tSettings("target_max")}</label>
            <input style={inp} type="number" value={settings.targetMax} onChange={e => upd("targetMax", parseInt(e.target.value)||180)}/>
          </div>
        </div>
      </BottomSheet>

      {/* GLUCOSE — Einheiten (info-only, mg/dL is the only supported unit today) */}
      <BottomSheet open={openSheet === "units"} onClose={closeSheet} title={tSettings("sheet_units_title")} footer={closeFooter}>
        <p style={{ fontSize:13, color:"var(--text-body)", lineHeight:1.55, margin:0 }}>
          {tSettings("sheet_units_body")}
        </p>
      </BottomSheet>

      {/* INSULIN — ICR + CF share the same sheet content (Insulin-Parameter
          card from the old layout), but each row opens it focused on its own
          field. Both inputs render in both sheets so users can tweak
          related values without re-navigating. */}
      <BottomSheet open={openSheet === "icr" || openSheet === "cf"} onClose={closeSheet} title={tSettings("insulin_params")} footer={saveFooter}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div>
            <label style={{ fontSize:12, color:"var(--text-dim)", display:"block", marginBottom:6 }}>{tSettings("icr_label")}</label>
            <input style={inp} type="number" autoFocus={openSheet === "icr"} value={settings.icr} onChange={e => upd("icr", parseInt(e.target.value)||15)}/>
            <div style={{ fontSize:11, color:"var(--text-ghost)", marginTop:4 }}>{tSettings("icr_hint")}</div>
          </div>
          <div>
            <label style={{ fontSize:12, color:"var(--text-dim)", display:"block", marginBottom:6 }}>{tSettings("cf_label")}</label>
            <input style={inp} type="number" autoFocus={openSheet === "cf"} value={settings.cf} onChange={e => upd("cf", parseInt(e.target.value)||50)}/>
            <div style={{ fontSize:11, color:"var(--text-ghost)", marginTop:4 }}>{tSettings("cf_hint")}</div>
          </div>
        </div>
      </BottomSheet>

      {/* CGM — LibreLinkUp */}
      <BottomSheet open={openSheet === "cgm_librelinkup"} onClose={closeSheet} title={tSettings("row_cgm_librelinkup")} footer={closeFooter}>
        <CgmSettingsCard />
      </BottomSheet>

      {/* CGM — Nightscout */}
      <BottomSheet open={openSheet === "cgm_nightscout"} onClose={closeSheet} title={tSettings("row_cgm_nightscout")} footer={closeFooter}>
        <NightscoutSettingsCard />
      </BottomSheet>

      {/* CGM — Dexcom (info-only placeholder until native integration ships) */}
      <BottomSheet open={openSheet === "cgm_dexcom"} onClose={closeSheet} title={tSettings("sheet_dexcom_title")} footer={closeFooter}>
        <p style={{ fontSize:13, color:"var(--text-body)", lineHeight:1.55, margin:0 }}>
          {tSettings("sheet_dexcom_body")}
        </p>
      </BottomSheet>

      {/* APP — Erscheinungsbild (instant-apply, no save needed) */}
      <BottomSheet open={openSheet === "appearance"} onClose={closeSheet} title={tSettings("appearance")} footer={closeFooter}>
        <div style={{ fontSize:12, color:"var(--text-dim)", marginBottom:14, lineHeight:1.5 }}>
          {tSettings("appearance_hint")}
        </div>
        <div role="radiogroup" aria-label={tSettings("appearance")} style={{
          display:"flex", gap:2, padding:4, borderRadius:99,
          background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
        }}>
          {([
            { v: "dark"   as ThemeChoice, label: tSettings("theme_dark") },
            { v: "light"  as ThemeChoice, label: tSettings("theme_light") },
            { v: "system" as ThemeChoice, label: tSettings("theme_system") },
          ]).map(opt => {
            const active = themeChoice === opt.v;
            return (
              <button key={opt.v} role="radio" aria-checked={active} onClick={() => setThemeChoice(opt.v)}
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                  background: active ? ACCENT : "transparent",
                  color: active ? "#fff" : "var(--text-body)",
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  transition: "background 120ms ease, color 120ms ease",
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* APP — Kohlenhydrate-Einheit (instant-apply, no save needed). DACH
          users typically rechnen in BE/KE statt Gramm. The hook persists
          to profiles.carb_unit and the rest of the app reads it via the
          same useCarbUnit() hook. */}
      <BottomSheet open={openSheet === "carb_unit"} onClose={closeSheet} title={tSettings("carb_unit_title")} footer={closeFooter}>
        <div style={{ fontSize:12, color:"var(--text-dim)", marginBottom:14, lineHeight:1.5 }}>
          {tSettings("carb_unit_hint")}
        </div>
        <div role="radiogroup" aria-label={tSettings("carb_unit_title")} style={{
          display:"flex", gap:2, padding:4, borderRadius:99,
          background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
        }}>
          {([
            { v: "g"  as CarbUnit, label: tSettings("carb_unit_g") },
            { v: "BE" as CarbUnit, label: tSettings("carb_unit_be") },
            { v: "KE" as CarbUnit, label: tSettings("carb_unit_ke") },
          ]).map(opt => {
            const active = carbUnit.unit === opt.v;
            return (
              <button key={opt.v} role="radio" aria-checked={active} onClick={() => carbUnit.setUnit(opt.v)}
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                  background: active ? ACCENT : "transparent",
                  color: active ? "#fff" : "var(--text-body)",
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  transition: "background 120ms ease, color 120ms ease",
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:12, lineHeight:1.5 }}>
          {carbUnit.description}
        </div>
      </BottomSheet>

      {/* APP — Sprache / Region (own commit logic via Save inside the row) */}
      <BottomSheet open={openSheet === "language"} onClose={closeSheet} title={tSettings("language_card_title")} footer={closeFooter}>
        <div style={{ display:"flex", gap:10, alignItems:"stretch" }}>
          <select
            value={pendingLocale ?? currentLocale}
            onChange={e => {
              const next = e.target.value as Locale;
              setPendingLocale(next === currentLocale ? null : next);
            }}
            style={{
              flex:1, padding:"12px 14px", borderRadius:10,
              border:`1px solid ${BORDER}`, background:SURFACE,
              color:"var(--text)", fontSize:14, fontWeight:500, cursor:"pointer",
              appearance:"none", WebkitAppearance:"none",
              backgroundImage:"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23888' d='M2 4l4 4 4-4z'/></svg>\")",
              backgroundRepeat:"no-repeat",
              backgroundPosition:"right 14px center",
              paddingRight:36,
            }}
          >
            <option value="de" style={{ background:SURFACE, color:"var(--text)" }}>🇩🇪 Deutsch</option>
            <option value="en" style={{ background:SURFACE, color:"var(--text)" }}>🇬🇧 English</option>
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
              padding:"12px 22px", borderRadius:10,
              border:`1px solid ${pendingLocale ? ACCENT : BORDER}`,
              background: pendingLocale ? ACCENT : "transparent",
              color: pendingLocale ? "#fff" : "var(--text-faint)",
              fontSize:14, fontWeight:600,
              cursor: pendingLocale ? "pointer" : "not-allowed",
              whiteSpace:"nowrap",
              transition:"background 120ms ease, color 120ms ease, border-color 120ms ease",
            }}
          >
            {tCommon("save")}
          </button>
        </div>
        {pendingLocale && (
          <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:10, lineHeight:1.5 }}>
            {tSettings("language_confirm_body")}
          </div>
        )}
      </BottomSheet>

      {/* APP — Benachrichtigungen */}
      <BottomSheet open={openSheet === "notifications"} onClose={closeSheet} title={tSettings("notifications")} footer={saveFooter}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {[
            { key:"notifySpike" as const, label:tSettings("notify_spike_label"), desc:tSettings("notify_spike_desc") },
            { key:"notifyHypo"  as const, label:tSettings("notify_hypo_label"),  desc:tSettings("notify_hypo_desc") },
          ].map(n => (
            <div key={n.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:"var(--surface-soft)", borderRadius:10 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:500 }}>{n.label}</div>
                <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:2 }}>{n.desc}</div>
              </div>
              <div onClick={() => upd(n.key, !settings[n.key])} style={{
                width:44, height:24, borderRadius:99, cursor:"pointer",
                background:settings[n.key]?ACCENT:"var(--border-strong)",
                border:`1px solid ${settings[n.key]?ACCENT+"60":BORDER}`,
                position:"relative", transition:"background 0.2s",
              }}>
                <div style={{ position:"absolute", top:2, left:settings[n.key]?22:2, width:18, height:18, borderRadius:99, background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }}/>
              </div>
            </div>
          ))}
        </div>
      </BottomSheet>

      {/* APP — Daten exportieren */}
      <BottomSheet open={openSheet === "export"} onClose={closeSheet} title={tSettings("row_export")} footer={closeFooter}>
        <ExportPanel />
      </BottomSheet>

      {/* ADVANCED — Makro-Ziele */}
      <BottomSheet open={openSheet === "macros"} onClose={closeSheet} title={tSettings("daily_macros_title")} footer={saveFooter}>
        <div style={{ fontSize:12, color:"var(--text-dim)", marginBottom:16, lineHeight:1.5 }}>
          {tSettings("daily_macros_desc")}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          {([
            { key:"carbs",   label:tSettings("macro_carbs_label"),   def:250, max:2000 },
            { key:"protein", label:tSettings("macro_protein_label"), def:120, max:2000 },
            { key:"fat",     label:tSettings("macro_fat_label"),     def:80,  max:2000 },
            { key:"fiber",   label:tSettings("macro_fiber_label"),   def:30,  max:200  },
          ] as Array<{ key: keyof MacroTargets; label: string; def: number; max: number }>).map(target => (
            <div key={target.key}>
              <label style={{ fontSize:12, color:"var(--text-dim)", display:"block", marginBottom:6 }}>{target.label}</label>
              <input
                style={inp}
                type="number"
                min={0}
                max={target.max}
                value={macroTargets[target.key]}
                onChange={e => {
                  const n = parseInt(e.target.value);
                  updMacro(target.key, Number.isFinite(n) ? Math.max(0, Math.min(target.max, n)) : target.def);
                }}
              />
            </div>
          ))}
        </div>
      </BottomSheet>

      {/* ADVANCED — Historische Daten */}
      <BottomSheet open={openSheet === "historical"} onClose={closeSheet} title={tSettings("historical_data_title")} footer={closeFooter}>
        <div style={{ fontSize:12, color:"var(--text-dim)", marginBottom:14, lineHeight:1.5 }}>
          {tSettings("historical_data_desc")}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <button onClick={handleReloadHistorical} disabled={reloading} style={{
            padding:"10px 18px", borderRadius:10, border:`1px solid ${ACCENT}40`, cursor: reloading ? "wait" : "pointer",
            background:`${ACCENT}15`, color:ACCENT, fontSize:13, fontWeight:600, opacity: reloading ? 0.6 : 1,
          }}>
            {reloading ? tSettings("historical_loading") : tSettings("historical_reload")}
          </button>
          {reloadMsg && (
            <span style={{ fontSize:12, color: reloadMsg.kind === "error" ? PINK : GREEN }}>{reloadMsg.text}</span>
          )}
        </div>
      </BottomSheet>

      {/* ADVANCED — Google Sheets (placeholder) */}
      <BottomSheet open={openSheet === "google_sheets"} onClose={closeSheet} title={tSettings("google_sheets_title")} footer={closeFooter}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:12 }}>
          <div style={{
            width:40, height:40, borderRadius:10, flexShrink:0,
            background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="3" y1="15" x2="21" y2="15"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
          </div>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:"var(--text-strong)", marginBottom:4 }}>
              {tSettings("google_sheets_title")}
            </div>
            <div style={{ fontSize:12, color:"var(--text-dim)", marginBottom:8 }}>
              {tSettings("google_sheets_desc")}
            </div>
            <span style={{
              fontSize:10, fontWeight:700, padding:"4px 10px", borderRadius:99,
              background:"var(--surface-soft)", color:"var(--text-dim)",
              border:`1px solid ${BORDER}`, letterSpacing:"0.08em", textTransform:"uppercase",
              whiteSpace:"nowrap",
            }}>
              {tSettings("coming_soon")}
            </span>
          </div>
        </div>
        <div style={{ fontSize:11, color:"var(--text-faint)", lineHeight:1.5 }}>
          {tSettings("google_sheets_footnote")}
        </div>
      </BottomSheet>

      {/* ADVANCED — Daten importieren */}
      <BottomSheet open={openSheet === "import"} onClose={closeSheet} title={tSettings("row_import")} footer={closeFooter}>
        <ImportPanel embedded />
      </BottomSheet>
    </div>
  );
}
