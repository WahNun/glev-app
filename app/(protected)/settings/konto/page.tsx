"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { parseDbDate } from "@/lib/time";
import { localeToBcp47 } from "@/lib/time";
import {
  fetchUserProfile, saveUserProfile,
  EMPTY_USER_PROFILE, type UserProfile, type Sex,
} from "@/lib/userProfile";
import { useFeatureFlag } from "@/lib/featureFlags";
import { usePlan } from "@/hooks/usePlan";
import AccountSheet from "@/components/AccountSheet";
import BottomSheet from "@/components/BottomSheet";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";

const ACCENT = "#4F6EF7", PINK = "#FF2D78", PURPLE = "#A78BFA", GREEN = "#22D3A0", BORDER = "var(--border)";
const inp: React.CSSProperties = { background: "var(--input-bg)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14, outline: "none", width: "100%" };
const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function KontoSettingsPage() {
  const t = useTranslations("settings");
  const router = useRouter();
  const uiLocale = useLocale();
  const bcp47 = localeToBcp47(uiLocale);
  const aiVoiceEnabled = useFeatureFlag("ai_voice");

  const [accountEmail, setAccountEmail] = useState("");
  const [plan, setPlan] = useState<EffectivePlan>("free");
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const [aboutSexDraft, setAboutSexDraft] = useState<Sex | null>(null);
  const [aboutBirthYearDraft, setAboutBirthYearDraft] = useState("");
  const [aboutHeightDraft, setAboutHeightDraft] = useState("");
  const [aboutWeightDraft, setAboutWeightDraft] = useState("");
  const [openAboutMe, setOpenAboutMe] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [referralSharing, setReferralSharing] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [referralCounts, setReferralCounts] = useState<{ referred: number; rewarded: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setAccountEmail(user?.email ?? "");
      } catch { /* ignore */ }
      try {
        if (!supabase) return;
        const { count } = await supabase.from("meals").select("id", { count: "exact", head: true });
        // count loaded but not displayed in this sub-page (AccountSheet shows it)
        void count;
      } catch { /* ignore */ }
    })();
    fetch("/api/me/plan", { credentials: "include" })
      .then((r) => r.ok ? r.json() : { plan: "free" })
      .then((j: { plan?: EffectivePlan }) => { if (!cancelled && j.plan) setPlan(j.plan); })
      .catch(() => {});
    fetchUserProfile().then(setUserProfile).catch(() => {});
    fetch("/api/me/referral", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((j: { referredCount?: number; rewardedCount?: number } | null) => {
        if (!cancelled && j) setReferralCounts({ referred: j.referredCount ?? 0, rewarded: j.rewardedCount ?? 0 });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bcp47]);

  const handleShareReferral = useCallback(async () => {
    if (referralSharing) return;
    setReferralSharing(true);
    try {
      const res = await fetch("/api/me/referral", { credentials: "include" });
      if (!res.ok) throw new Error("api_error");
      const { shareUrl, referredCount, rewardedCount } = await res.json() as {
        shareUrl: string; referredCount: number; rewardedCount: number;
      };
      setReferralCounts({ referred: referredCount, rewarded: rewardedCount });

      const title = t("referral_share_title");
      const text = t("referral_share_text", { url: shareUrl });

      try {
        const { Share } = await import("@capacitor/share");
        const { value: canShare } = await Share.canShare();
        if (canShare) { await Share.share({ title, text, url: shareUrl, dialogTitle: title }); return; }
      } catch { /* fallthrough to web */ }

      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text, url: shareUrl }); return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setReferralCopied(true);
      setTimeout(() => setReferralCopied(false), 2500);
    } catch { /* ignore */ } finally {
      setReferralSharing(false);
    }
  }, [referralSharing, t]);

  const openAboutMeSheet = useCallback(() => {
    setUserProfile((cur) => {
      setAboutSexDraft(cur.sex);
      setAboutBirthYearDraft(cur.birthYear ? String(cur.birthYear) : "");
      setAboutHeightDraft(cur.heightCm ? String(cur.heightCm) : "");
      setAboutWeightDraft(cur.weightKg ? String(cur.weightKg) : "");
      return cur;
    });
    setSaveError("");
    setOpenAboutMe(true);
  }, []);

  const closeAboutMe = useCallback(() => {
    setSaveError("");
    setOpenAboutMe(false);
  }, []);

  const saveAboutMe = useCallback(async (): Promise<boolean> => {
    setSaveError("");
    if (aboutSexDraft === null) { setSaveError(t("about_me_sex_required")); return false; }
    const birthYearNum = parseInt(aboutBirthYearDraft, 10);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(birthYearNum) || birthYearNum < 1900 || birthYearNum > currentYear) {
      setSaveError(t("about_me_birth_year_invalid", { min: 1900, max: currentYear })); return false;
    }
    const heightNum = aboutHeightDraft.trim() === "" ? null : parseInt(aboutHeightDraft, 10);
    if (heightNum !== null && (!Number.isInteger(heightNum) || heightNum < 50 || heightNum > 280)) {
      setSaveError(t("about_me_height_invalid")); return false;
    }
    const weightNum = aboutWeightDraft.trim() === "" ? null : parseFloat(aboutWeightDraft.replace(",", "."));
    if (weightNum !== null && (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400)) {
      setSaveError(t("about_me_weight_invalid")); return false;
    }
    setSaving(true);
    try {
      await saveUserProfile({ sex: aboutSexDraft, birthYear: birthYearNum, heightCm: heightNum, weightKg: weightNum });
      setUserProfile({ sex: aboutSexDraft, birthYear: birthYearNum, heightCm: heightNum, weightKg: weightNum });
      setSaved(true); setTimeout(() => setSaved(false), 1500);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed")); return false;
    } finally { setSaving(false); }
  }, [aboutSexDraft, aboutBirthYearDraft, aboutHeightDraft, aboutWeightDraft, t]);

  const aboutMeSub = (() => {
    const parts: string[] = [];
    if (userProfile.sex === "female") parts.push(t("about_me_sex_female"));
    else if (userProfile.sex === "male") parts.push(t("about_me_sex_male"));
    else if (userProfile.sex === "diverse") parts.push(t("about_me_sex_diverse"));
    if (userProfile.birthYear) {
      const age = new Date().getFullYear() - userProfile.birthYear;
      parts.push(t("about_me_age", { age }));
    }
    return parts.length > 0 ? parts.join(" · ") : t("about_me_unset");
  })();

  function SaveFooter({ onSave }: { onSave: () => Promise<boolean> }) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {saveError && <div style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center" }}>{saveError}</div>}
        <button type="button" onClick={async () => { const ok = await onSave(); if (ok) setOpenAboutMe(false); }} disabled={saving} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", cursor: saving ? "wait" : "pointer", background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`, color: "var(--on-accent)", fontSize: 14, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving ? t("save_button_busy") : saved ? t("save_button_done") : t("save_button_label", { defaultValue: "Speichern" })}
        </button>
      </div>
    );
  }

  const sexOpts: { key: Sex; label: string }[] = [
    { key: "female",  label: t("about_me_sex_female") },
    { key: "male",    label: t("about_me_sex_male") },
    { key: "diverse", label: t("about_me_sex_diverse") },
  ];
  const inputStyle: React.CSSProperties = { ...inp, fontSize: 16 };
  const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
  const currentYear = new Date().getFullYear();

  const aboutMeBody: ReactNode = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 13, color: "var(--text-faint)", margin: 0, lineHeight: 1.5 }}>{t("about_me_sheet_desc")}</p>
      <div>
        <div style={labelStyle}>{t("about_me_sex_label")} <span style={{ color: PINK }}>*</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {sexOpts.map((opt) => {
            const active = aboutSexDraft === opt.key;
            return (
              <button key={opt.key} type="button" onClick={() => setAboutSexDraft(opt.key)} aria-pressed={active} style={{ padding: "12px 8px", borderRadius: 10, border: `1px solid ${active ? ACCENT : BORDER}`, background: active ? `${ACCENT}1F` : "var(--surface-soft)", color: active ? "var(--text-strong)" : "var(--text-body)", fontWeight: active ? 700 : 500, fontSize: 14, fontFamily: "inherit", cursor: "pointer", minHeight: 44 }}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={labelStyle}>{t("about_me_birth_year_label")} <span style={{ color: PINK }}>*</span></div>
        <input inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder={String(currentYear - 30)} value={aboutBirthYearDraft} onChange={(e) => setAboutBirthYearDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} style={inputStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={labelStyle}>{t("about_me_height_label")}</div>
          <input inputMode="numeric" pattern="[0-9]*" maxLength={3} placeholder="170" value={aboutHeightDraft} onChange={(e) => setAboutHeightDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>{t("about_me_weight_label")}</div>
          <input inputMode="decimal" maxLength={5} placeholder="70" value={aboutWeightDraft} onChange={(e) => setAboutWeightDraft(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))} style={inputStyle} />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-faint)", margin: 0, lineHeight: 1.5 }}>{t("about_me_optional_hint")}</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {t("page_title")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{t("section_account")}</h1>
      </div>

      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>}
          label={t("row_account")}
          subtitle={accountEmail || t("account_subtitle_placeholder")}
          ariaLabel={t("row_open_aria", { label: t("row_account") })}
          onClick={() => setAccountSheetOpen(true)}
        />
        <SettingsRow
          iconColor={PURPLE}
          icon={<svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>}
          label={t("about_me_row_label")}
          subtitle={aboutMeSub}
          ariaLabel={t("row_open_aria", { label: t("about_me_row_label") })}
          onClick={openAboutMeSheet}
        />
        {aiVoiceEnabled && (
          <SettingsRow
            iconColor={ACCENT}
            icon={<svg {...iconProps}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>}
            label={t("section_glev_ai")}
            subtitle={t("ai_settings_row_subtitle")}
            ariaLabel={t("section_glev_ai")}
            onClick={() => router.push("/settings/ai")}
          />
        )}
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...iconProps}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>}
          label={referralCopied ? t("referral_share_copy_success") : (referralSharing ? "…" : t("row_referral"))}
          subtitle={
            referralCounts && referralCounts.referred > 0
              ? `${t("referral_referred_count", { n: referralCounts.referred })} · ${t("referral_rewarded_count", { n: referralCounts.rewarded })}`
              : t("subtitle_referral")
          }
          ariaLabel={t("row_referral")}
          onClick={handleShareReferral}
        />
        {plan === "plus" && (
          <SettingsRow
            iconColor={PURPLE}
            icon={<svg {...iconProps}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>}
            label={t("row_founder_contact")}
            subtitle={t("subtitle_founder_contact")}
            ariaLabel={t("row_open_aria", { label: t("row_founder_contact") })}
            onClick={() => window.open("mailto:lucas@glev.app", "_blank", "noopener,noreferrer")}
          />
        )}
      </SettingsSection>

      <BottomSheet open={openAboutMe} onClose={closeAboutMe} title={t("about_me_sheet_title")} footer={<SaveFooter onSave={saveAboutMe} />}>
        {aboutMeBody}
      </BottomSheet>

      <AccountSheet open={accountSheetOpen} onClose={() => setAccountSheetOpen(false)} />
    </div>
  );
}
