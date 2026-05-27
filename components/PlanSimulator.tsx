"use client";

/**
 * Plan-Simulator — nur für den Admin-Account sichtbar.
 *
 * Zeigt einen Segmented-Control in den Einstellungen der es Lucas erlaubt
 * schnell zwischen Plan-Tiers zu wechseln um die UX aus User-Perspektive
 * zu testen — ohne den echten Account-Plan zu ändern.
 *
 * Sichtbarkeit: nur wenn die eingeloggte Email mit NEXT_PUBLIC_ADMIN_EMAIL
 * übereinstimmt. Für alle anderen User wird null gerendert.
 *
 * Der Override ist rein client-seitig (localStorage). Server-seitige
 * API-Checks sind davon nicht betroffen.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getPlanOverride,
  setPlanOverride,
  clearPlanOverride,
} from "@/lib/planOverride";
import { invalidatePlanCache } from "@/hooks/usePlan";
import type { EffectivePlan } from "@/lib/admin/effectivePlan";

const ACCENT  = "#4F6EF7";
const ORANGE  = "#FF9500";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

type Slot = { plan: EffectivePlan | null; label: string; badge: string; color: string };

const SLOTS: Slot[] = [
  { plan: null,   label: "Real",        badge: "—",   color: "var(--text-dim)" },
  { plan: "free", label: "Free",        badge: "F",   color: "var(--text-dim)" },
  { plan: "beta", label: "Smart (S)",   badge: "S",   color: "#22D3A0" },
  { plan: "pro",  label: "Pro (M)",     badge: "M",   color: ACCENT },
  { plan: "plus", label: "Glev+ (L)",   badge: "L",   color: "#A78BFA" },
];

export default function PlanSimulator() {
  const [visible, setVisible] = useState(false);
  const [override, setOverride] = useState<EffectivePlan | null>(null);

  useEffect(() => {
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
    if (!adminEmail || !supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email === adminEmail) {
        setVisible(true);
        setOverride(getPlanOverride());
      }
    });
  }, []);

  // Sync override state if changed from another tab
  useEffect(() => {
    const onOverrideChange = () => setOverride(getPlanOverride());
    window.addEventListener("glev:plan-override-change", onOverrideChange);
    return () => window.removeEventListener("glev:plan-override-change", onOverrideChange);
  }, []);

  if (!visible) return null;

  function handleSelect(plan: EffectivePlan | null) {
    if (plan === null) {
      clearPlanOverride();
    } else {
      setPlanOverride(plan);
    }
    setOverride(plan);
    invalidatePlanCache();
    // Force full page reload so all components pick up the new plan
    window.location.reload();
  }

  const activeSlot = SLOTS.find((s) => s.plan === override) ?? SLOTS[0];

  return (
    <div style={{
      margin: "0 0 4px",
      padding: "16px",
      background: SURFACE,
      border: `1px solid ${ORANGE}40`,
      borderRadius: 14,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🧪</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}>
            Plan-Simulator
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>
            Nur für dich sichtbar · client-seitig · kein echter Plan-Wechsel
          </div>
        </div>
        {override !== null && (
          <div style={{
            padding: "2px 8px", borderRadius: 20,
            background: `${ORANGE}18`, color: ORANGE,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            AKTIV
          </div>
        )}
      </div>

      {/* Segmented control */}
      <div style={{
        display: "flex", gap: 6, flexWrap: "wrap",
      }}>
        {SLOTS.map((slot) => {
          const isActive = slot.plan === override;
          return (
            <button
              key={slot.label}
              onClick={() => handleSelect(slot.plan)}
              style={{
                flex: "1 1 0",
                minWidth: 60,
                padding: "8px 4px",
                borderRadius: 10,
                border: isActive
                  ? `1.5px solid ${slot.color}`
                  : `1px solid ${BORDER}`,
                background: isActive
                  ? `${slot.color}18`
                  : "var(--surface-soft)",
                color: isActive ? slot.color : "var(--text-dim)",
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "center",
              }}
            >
              {slot.label}
            </button>
          );
        })}
      </div>

      {/* Active state hint */}
      <div style={{
        fontSize: 11,
        color: override !== null ? ORANGE : "var(--text-faint)",
        lineHeight: 1.5,
      }}>
        {override !== null
          ? `Aktiv: ${activeSlot.label} — du siehst die App wie ein ${activeSlot.label}-User. Alle anderen sehen ihren echten Plan.`
          : "Kein Override aktiv — du siehst deinen echten Plan."}
      </div>
    </div>
  );
}
