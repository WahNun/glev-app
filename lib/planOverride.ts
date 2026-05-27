/**
 * Plan-Override für den Admin-Account.
 *
 * Speichert einen lokalen Plan-Override in localStorage damit Lucas die
 * UX der verschiedenen Pakete (Free, Smart/S, Pro/M, Glev+/L) testen
 * kann ohne seinen echten Plan zu ändern.
 *
 * Sicherheitshinweis: Der Override ist rein client-seitig. Er ändert
 * was der Browser rendert, aber keine server-seitigen API-Checks.
 * Kein echter User erhält dadurch Zugang zu gesperrten Features auf
 * dem Server.
 *
 * Nur sichtbar für den Account dessen Email NEXT_PUBLIC_ADMIN_EMAIL entspricht.
 */

import type { EffectivePlan } from "@/lib/admin/effectivePlan";

const KEY = "glev_plan_override";

export function getPlanOverride(): EffectivePlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    if (raw === "free" || raw === "beta" || raw === "pro" || raw === "plus") {
      return raw as EffectivePlan;
    }
    return null;
  } catch {
    return null;
  }
}

export function setPlanOverride(plan: EffectivePlan | null): void {
  if (typeof window === "undefined") return;
  try {
    if (plan === null) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, plan);
    }
    // Broadcast to all tabs so every usePlan() instance refreshes.
    window.dispatchEvent(new CustomEvent("glev:plan-override-change"));
  } catch {
    // ignore
  }
}

export function clearPlanOverride(): void {
  setPlanOverride(null);
}
