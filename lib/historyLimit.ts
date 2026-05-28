/**
 * History-Limit-Utilities für Glev.
 *
 * Drei Stufen (D-XXX):
 *   Free / Smart (beta) → 60 Tage  (history_60d — "all")
 *   Pro + aktiver Trial  → 90 Tage  (history_90d — "pro")
 *   Plus                 → unlimitiert (unlimited_history — "plus")
 *
 * Alle Stellen, die historische Daten abrufen, importieren diese Datei
 * und berechnen darüber die früheste Cutoff-Zeit — nie mehr hartcodierte
 * 365-Tage-Fenster in Client-Komponenten.
 */

import type { EffectivePlan } from "@/lib/admin/effectivePlan";
import { canAccess } from "@/lib/planFeatures";

/**
 * Gibt die maximale Historien-Tiefe in Tagen zurück.
 * `null` bedeutet "unbegrenzt" (nur Plus).
 */
export function getHistoryLimitDays(
  plan: EffectivePlan,
  trialActive: boolean,
): number | null {
  if (canAccess("unlimited_history", plan, trialActive)) return null;
  if (canAccess("history_90d",       plan, trialActive)) return 90;
  return 60;
}

/**
 * Gibt den frühesten erlaubten Zeitstempel als ISO-String zurück.
 * `null` = kein Limit (Plus-User).
 *
 * Die Cutoff-Zeit wird auf Mitternacht (00:00:00.000 UTC) normiert, damit
 * ein Free-User am Anfang eines Tages nicht zufällig weniger sieht als
 * am Abend desselben Tages.
 */
export function getHistoryCutoffISO(
  plan: EffectivePlan,
  trialActive: boolean,
): string | null {
  const days = getHistoryLimitDays(plan, trialActive);
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Wählt das spätere (= restriktivere) der beiden Datümer aus.
 * Nützlich für Export-Panels: wenn der User „seit 2023" wählt, aber
 * sein Plan nur 60 Tage erlaubt, gewinnt der Plan-Cutoff.
 *
 * Gibt `planCutoff` zurück, wenn `userFrom` fehlt oder älter ist.
 */
export function clampFromToPlan(
  userFrom: string | undefined,
  planCutoff: string | null,
): string | undefined {
  if (!planCutoff) return userFrom;
  if (!userFrom) return planCutoff;
  return userFrom > planCutoff ? userFrom : planCutoff;
}
