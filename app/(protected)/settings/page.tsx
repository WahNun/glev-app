"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import { reloadHistoricalEntries } from "@/lib/meals";
import { fetchMacroTargets, saveMacroTargets, DEFAULT_MACRO_TARGETS, type MacroTargets } from "@/lib/userSettings";
import ImportPanel from "@/components/ImportPanel";
import ExportPanel from "@/components/ExportPanel";
import CgmSettingsCard from "@/components/CgmSettingsCard";
import NightscoutSettingsCard from "@/components/NightscoutSettingsCard";
import { parseDbDate } from "@/lib/time";
import { setLocale, readLocaleCookie, DEFAULT_LOCALE, type Locale } from "@/lib/locale";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

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

export default function SettingsPage() {
  const tSettings = useTranslations("settings");
  const [tab, setTab]         = useState<"overview"|"settings"|"integrations"|"data">("overview");
  const [email, setEmail]     = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [settings, setSettings]   = useState<Settings>(DEFAULTS);
  const [saved, setSaved]     = useState(false);
  const [mealCount, setMealCount] = useState<number>(0);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState<string>("");
  // Reflects the NEXT_LOCALE cookie so the language toggle highlights
  // the correct button immediately on mount. Reads in an effect because
  // document.cookie is browser-only — server render shows DEFAULT.
  const [currentLocale, setCurrentLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    const fromCookie = readLocaleCookie();
    if (fromCookie) setCurrentLocale(fromCookie);
  }, []);
  // Macro targets live in Supabase (user_settings table) rather than
  // localStorage so they sync across devices. Their own dedicated Save
  // button keeps the existing localStorage Save Settings flow untouched.
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email || "");
      setCreatedAt(user.created_at ? parseDbDate(user.created_at).toLocaleDateString("en",{year:"numeric",month:"long",day:"numeric"}) : "");
    });
    supabase.from("meals").select("id", { count:"exact", head:true }).then(({ count }) => setMealCount(count||0));
    // fetchMacroTargets handles the !supabase / signed-out case internally
    // by resolving to DEFAULT_MACRO_TARGETS, so it's safe to call here.
    fetchMacroTargets().then(setMacroTargets).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      saveSettings(settings);
      await saveMacroTargets(macroTargets);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      setTimeout(() => setSaveError(""), 4000);
    } finally {
      setSaving(false);
    }
  }

  async function handleReloadHistorical() {
    if (!confirm("This will replace ALL your meal entries with the historical sample data (Apr 17–22, 2026). Continue?")) return;
    setReloading(true);
    setReloadMsg("");
    try {
      const { inserted } = await reloadHistoricalEntries();
      setReloadMsg(`Loaded ${inserted} historical entries`);
      const { count } = await supabase!.from("meals").select("id", { count:"exact", head:true });
      setMealCount(count || 0);
    } catch (e) {
      setReloadMsg(`Error: ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setReloading(false);
      setTimeout(() => setReloadMsg(""), 4000);
    }
  }

  function upd<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: val }));
  }

  function updMacro<K extends keyof MacroTargets>(key: K, val: MacroTargets[K]) {
    setMacroTargets(prev => ({ ...prev, [key]: val }));
  }

  const card: React.CSSProperties = { background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"20px 24px" };
  const inp: React.CSSProperties  = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:14, outline:"none", width:"100%" };

  return (
    <div style={{ maxWidth:720, margin:"0 auto" }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Account</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>Manage your profile and Glev settings.</p>
      </div>

      {/* TABS */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:24, background:"rgba(255,255,255,0.04)", borderRadius:12, padding:4, width:"100%" }}>
        {(["overview","settings","integrations","data"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:"8px 6px", borderRadius:9, border:"none", cursor:"pointer",
            background:tab===t?SURFACE:"transparent",
            color:tab===t?"#fff":"rgba(255,255,255,0.45)",
            fontSize:12, fontWeight:tab===t?600:500,
            boxShadow:tab===t?"0 1px 4px rgba(0,0,0,0.4)":"none",
            textTransform: "capitalize",
            whiteSpace:"nowrap",
            textAlign:"center",
            letterSpacing:"-0.01em",
            minWidth:0,
            overflow:"hidden",
            textOverflow:"ellipsis",
            transition:"background 120ms ease, color 120ms ease",
          }}>{t}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* Profile */}
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Profile</div>
            <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
              <div style={{ width:56, height:56, borderRadius:99, background:`linear-gradient(135deg,${ACCENT},#6B8BFF)`, border:`2px solid ${ACCENT}66`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:800, color:"#fff", letterSpacing:"-0.02em", textTransform:"uppercase" }}>
                {(email.split("@")[0] || "U").charAt(0)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                  <div style={{ fontSize:16, fontWeight:700 }}>{email.split("@")[0] || "User"}</div>
                  <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:99, background:`${ACCENT}20`, color:ACCENT, letterSpacing:"0.08em" }}>MEMBER</span>
                </div>
                <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)" }}>{email}</div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
              {[
                { label:"Member Since", val:createdAt||"—" },
                { label:"Meals Logged", val:mealCount.toString() },
                { label:"Plan", val:"Glev Free" },
              ].map(s => (
                <div key={s.label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"12px 14px" }}>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:4 }}>{s.label}</div>
                  <div style={{ fontSize:15, fontWeight:700 }}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ICR Info */}
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Deine Insulin-Einstellungen</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[
                { label:"Insulin-to-Carb Ratio", val:`1:${settings.icr}`, sub:"grams per unit", color:ACCENT },
                { label:"Correction Factor", val:`1:${settings.cf}`, sub:"mg/dL per unit", color:"#A78BFA" },
              ].map(s => (
                <div key={s.label} style={{ background:`${s.color}08`, border:`1px solid ${s.color}20`, borderRadius:12, padding:"14px 16px" }}>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:4 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{s.val}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{s.sub}</div>
                </div>
              ))}
              <div style={{ gridColumn:"1 / -1", background:`${GREEN}08`, border:`1px solid ${GREEN}20`, borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                <div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:4 }}>Target range</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)" }}>safe glucose window</div>
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:GREEN, letterSpacing:"-0.02em" }}>
                  {settings.targetMin} <span style={{ color:"rgba(255,255,255,0.3)" }}>—</span> {settings.targetMax}
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontWeight:500, marginLeft:6 }}>mg/dL</span>
                </div>
              </div>
            </div>
            <button onClick={() => setTab("settings")} style={{ marginTop:14, padding:"9px 18px", borderRadius:9, border:`1px solid ${BORDER}`, background:"transparent", color:"rgba(255,255,255,0.45)", fontSize:13, cursor:"pointer" }}>
              Edit Settings →
            </button>
          </div>

          {/* Historical Data */}
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Historical Data</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginBottom:14, lineHeight:1.5 }}>
              Replace your meal log with the 15 historical entries from the tracking sheet (Apr 17–22, 2026). Useful for resetting the app to a known demo state.
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={handleReloadHistorical} disabled={reloading} style={{
                padding:"10px 18px", borderRadius:10, border:`1px solid ${ACCENT}40`, cursor: reloading ? "wait" : "pointer",
                background:`${ACCENT}15`, color:ACCENT, fontSize:13, fontWeight:600, opacity: reloading ? 0.6 : 1,
              }}>
                {reloading ? "Loading…" : "Reload historical entries"}
              </button>
              {reloadMsg && (
                <span style={{ fontSize:12, color: reloadMsg.startsWith("Error") ? PINK : GREEN }}>{reloadMsg}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {/* LANGUAGE TOGGLE — first card in the Settings tab so it's
              easy to find. Calling setLocale() persists the choice to
              Supabase (profiles.language), updates the NEXT_LOCALE
              cookie, then hard-reloads so the server picks up the new
              messages bundle. We optimistically flip currentLocale so
              the active button highlights immediately even though the
              page is about to refresh. */}
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>
              {tSettings("language")} / Sprache / Language
            </div>
            <div style={{ display:"flex", gap:10 }}>
              {(["de","en"] as const).map(loc => {
                const active = currentLocale === loc;
                const label = loc === "de" ? "Deutsch" : "English";
                const flag  = loc === "de" ? "🇩🇪" : "🇬🇧";
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => { setCurrentLocale(loc); void setLocale(loc); }}
                    style={{
                      flex:1, padding:"12px 16px", borderRadius:10,
                      border:`1px solid ${active ? ACCENT : BORDER}`,
                      background: active ? ACCENT : "transparent",
                      color: active ? "#fff" : "rgba(255,255,255,0.7)",
                      fontSize:14, fontWeight:600, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                      transition:"background 120ms ease, color 120ms ease",
                    }}
                  >
                    <span style={{ fontSize:18 }}>{flag}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Glucose Targets</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Target Min (mg/dL)</label>
                <input style={inp} type="number" value={settings.targetMin} onChange={e => upd("targetMin", parseInt(e.target.value)||70)}/>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Target Max (mg/dL)</label>
                <input style={inp} type="number" value={settings.targetMax} onChange={e => upd("targetMax", parseInt(e.target.value)||180)}/>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Insulin Parameters</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Insulin-to-Carb Ratio (g/unit)</label>
                <input style={inp} type="number" value={settings.icr} onChange={e => upd("icr", parseInt(e.target.value)||15)}/>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:4 }}>e.g. 15 = 1 unit per 15g carbs</div>
              </div>
              <div>
                <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>Correction Factor (mg/dL per unit)</label>
                <input style={inp} type="number" value={settings.cf} onChange={e => upd("cf", parseInt(e.target.value)||50)}/>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", marginTop:4 }}>e.g. 50 = 1 unit drops BG by 50</div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>Notifications</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {[
                { key:"notifySpike" as const, label:"Alert on Spike Events", desc:"Notify when a meal results in a LOW evaluation (under-dosed)" },
                { key:"notifyHypo"  as const, label:"Alert on Hypo Risk",   desc:"Notify when a meal results in a HIGH evaluation (over-dosed)" },
              ].map(n => (
                <div key={n.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500 }}>{n.label}</div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:2 }}>{n.desc}</div>
                  </div>
                  <div onClick={() => upd(n.key, !settings[n.key])} style={{
                    width:44, height:24, borderRadius:99, cursor:"pointer",
                    background:settings[n.key]?ACCENT:"rgba(255,255,255,0.1)",
                    border:`1px solid ${settings[n.key]?ACCENT+"60":BORDER}`,
                    position:"relative", transition:"background 0.2s",
                  }}>
                    <div style={{ position:"absolute", top:2, left:settings[n.key]?22:2, width:18, height:18, borderRadius:99, background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Daily Macro Targets</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginBottom:16, lineHeight:1.5 }}>
              Powers the &quot;Today&apos;s Macros&quot; rings on the dashboard. Defaults are sensible Type-1 starting points — adjust to match your nutrition plan. Saved to your account, syncs across devices.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {([
                { key:"carbs",   label:"Carbs (g)",   def:250, max:2000 },
                { key:"protein", label:"Protein (g)", def:120, max:2000 },
                { key:"fat",     label:"Fat (g)",     def:80,  max:2000 },
                { key:"fiber",   label:"Fiber (g)",   def:30,  max:200  },
              ] as Array<{ key: keyof MacroTargets; label: string; def: number; max: number }>).map(t => (
                <div key={t.key}>
                  <label style={{ fontSize:12, color:"rgba(255,255,255,0.4)", display:"block", marginBottom:6 }}>{t.label}</label>
                  <input
                    style={inp}
                    type="number"
                    min={0}
                    max={t.max}
                    value={macroTargets[t.key]}
                    onChange={e => {
                      const n = parseInt(e.target.value);
                      updMacro(t.key, Number.isFinite(n) ? Math.max(0, Math.min(t.max, n)) : t.def);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={handleSave} disabled={saving} style={{
                flex:1, padding:"14px", borderRadius:12, border:"none",
                cursor: saving ? "wait" : "pointer",
                background:`linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color:"#fff",
                fontSize:15, fontWeight:700, boxShadow:`0 4px 20px ${ACCENT}40`,
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? "Speichere…" : saved ? "✓ Gespeichert!" : "Einstellungen speichern"}
              </button>
              <button
                onClick={() => { setSettings(DEFAULTS); setMacroTargets(DEFAULT_MACRO_TARGETS); }}
                style={{ padding:"14px 20px", borderRadius:12, border:`1px solid ${BORDER}`, background:"transparent", color:"rgba(255,255,255,0.4)", fontSize:14, cursor:"pointer" }}
              >
                Zurücksetzen
              </button>
            </div>
            {saveError && (
              <div style={{ fontSize:12, color:PINK, paddingLeft:4 }}>{saveError}</div>
            )}
          </div>
        </div>
      )}

      {tab === "integrations" && (
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
          {/* CGM (LibreLinkUp) */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:ACCENT, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
              CGM
            </div>
            <CgmSettingsCard />
          </div>

          {/* Nightscout — eigener self-hosted CGM server */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:ACCENT, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
              Nightscout
            </div>
            <NightscoutSettingsCard />
          </div>

          {/* Google Sheets — placeholder until OAuth flow is wired up */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:ACCENT, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
              Google
            </div>
            <div style={{
              ...card,
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:14, minWidth:0, flex:"1 1 240px" }}>
                <div style={{
                  width:40, height:40, borderRadius:10, flexShrink:0,
                  background:"rgba(255,255,255,0.05)", border:`1px solid ${BORDER}`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {/* Sheets glyph */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.9)", marginBottom:2 }}>
                    Google Sheets
                  </div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)" }}>
                    Mahlzeiten, Insulin und CGM in eine Tabelle synchronisieren.
                  </div>
                </div>
              </div>
              <span style={{
                fontSize:10, fontWeight:700, padding:"4px 10px", borderRadius:99,
                background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.5)",
                border:`1px solid ${BORDER}`, letterSpacing:"0.08em", textTransform:"uppercase",
                whiteSpace:"nowrap",
              }}>
                Coming soon
              </span>
            </div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginTop:8, lineHeight:1.5 }}>
              Verknüpfe dein Google-Konto, um deine Glev-Daten automatisch in eine eigene Google-Tabelle zu spiegeln. Folgt nach der CSV/PDF-Export-Funktion.
            </div>
          </div>
        </div>
      )}

      {tab === "data" && (
        <div style={{ display:"flex", flexDirection:"column", gap:32 }}>
          <ExportPanel />
          <div style={{ height:1, background:BORDER }}/>
          <ImportPanel embedded />
        </div>
      )}

      <p style={{
        marginTop: 48,
        marginBottom: 8,
        marginLeft: "auto",
        marginRight: "auto",
        maxWidth: 560,
        fontSize: 11,
        lineHeight: 1.55,
        color: "rgba(255,255,255,0.35)",
        textAlign: "center",
      }}>
        Glev ist ein Dokumentations- und Organisations-Tool, kein Medizinprodukt. Therapieentscheidungen triffst du in Absprache mit deinem Arzt.
      </p>
    </div>
  );
}
