"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { calcTotalIOB, getDIAMinutes, type BolusDose, type InsulinType } from "@/lib/iob";
import type { InsulinLog } from "@/lib/insulin";

const GREEN  = "#22D3A0";
const AMBER  = "#F59E0B";
const ORANGE = "#FF9500";

function iobColor(iob: number): string {
  if (iob < 1) return GREEN;
  if (iob < 3) return AMBER;
  return ORANGE;
}

const RADIUS = 44;
const CIRC   = 2 * Math.PI * RADIUS;
const MAX_IOB = 5;
const SZ = 116;

function CircleGauge({ iob, color }: { iob: number; color: string }) {
  const filled = Math.min(iob / MAX_IOB, 1) * CIRC;
  return (
    <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} aria-hidden="true">
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none" stroke="var(--surface-soft)" strokeWidth={9}
      />
      <circle
        cx={SZ / 2} cy={SZ / 2} r={RADIUS}
        fill="none" stroke={color} strokeWidth={9}
        strokeDasharray={`${filled} ${CIRC}`}
        strokeLinecap="round"
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
          transition: "stroke-dasharray .6s ease, stroke .3s ease",
        }}
      />
    </svg>
  );
}

interface Props {
  insulin: InsulinLog[];
  insulinType: InsulinType;
}

export default function IOBCard({ insulin, insulinType }: Props) {
  const t = useTranslations("dashboard");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const iv = setInterval(tick, 5 * 60_000);
    window.addEventListener("focus", tick, { passive: true });
    return () => { clearInterval(iv); window.removeEventListener("focus", tick); };
  }, []);

  const diaMin = getDIAMinutes(insulinType);

  const doses: BolusDose[] = insulin
    .filter(l => l.insulin_type === "bolus" && l.units > 0)
    .map(l => ({ units: l.units, administeredAt: l.created_at }));

  const iob     = calcTotalIOB(doses, insulinType, now);
  const cleared = iob < 0.05;
  const color   = iobColor(iob);

  const clearsInMin = cleared ? 0 : doses.reduce((max, d) => {
    const elapsed = (now - new Date(d.administeredAt).getTime()) / 60_000;
    if (elapsed >= diaMin) return max;
    return Math.max(max, Math.ceil(diaMin - elapsed));
  }, 0);

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 18, padding: "20px 20px 18px",
      display: "flex", flexDirection: "column", gap: 12, minHeight: 200,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.1em", fontWeight: 700 }}>
        {t("active_insulin").toUpperCase()}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <CircleGauge iob={iob} color={cleared ? "var(--surface-soft)" : color} />
        <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <div style={{
            fontSize: 28, fontWeight: 800, lineHeight: 1,
            fontFamily: "var(--font-mono)",
            color: cleared ? "var(--text-ghost)" : color,
          }}>
            {cleared ? "0.0" : iob.toFixed(1)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>IE</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        {cleared ? (
          <span style={{
            padding: "4px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            background: "var(--surface-soft)", color: "var(--text-ghost)", letterSpacing: "0.04em",
          }}>
            {t("iob_fully_cleared")}
          </span>
        ) : (
          <span style={{
            padding: "4px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            background: `${color}22`, color, letterSpacing: "0.04em",
          }}>
            {t("iob_cleared_in", { minutes: clearsInMin })}
          </span>
        )}
      </div>

      {!cleared && (
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.4 }}>
          {iob < 1 ? t("iob_risk_low") : iob < 3 ? t("iob_risk_moderate") : t("iob_risk_high")}
        </div>
      )}
    </div>
  );
}
