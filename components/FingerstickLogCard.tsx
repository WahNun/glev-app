"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  insertFingerstick,
  fetchLatestFingerstick,
  type FingerstickReading,
} from "@/lib/fingerstick";
import { isToday, isWithinDays, formatLocalTime } from "@/lib/utils/datetime";
import { hapticSuccess, hapticWarning, hapticError } from "@/lib/haptics";
import CollapsibleField from "@/components/log/CollapsibleField";
import NumberField from "@/components/log/NumberField";
import SaveButton from "@/components/log/SaveButton";

// Target band — out-of-range saves trigger a warning haptic.
const BG_LOW_TARGET  = 70;
const BG_HIGH_TARGET = 180;

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const PINK    = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FingerstickLogCard() {
  const t = useTranslations("fingerstick");

  function formatLatestWhen(iso: string): string {
    if (!iso) return iso;
    const time = formatLocalTime(iso, "time");
    if (time === "—") return iso;
    if (isToday(iso))         return t("latest_today", { time });
    // "gestern" = within last 2 days but not today.
    if (isWithinDays(iso, 2)) return t("latest_yesterday", { time });
    return t("latest_other", { date: formatLocalTime(iso, "date"), time });
  }

  // Free-form text input — keeps the user's exact typed glucose value
  // (e.g. "127") without any slider snapping. Validation + clamp happens
  // at save time. Empty string = nothing entered yet → save shows the
  // standard "value out of range" error so the user knows to type one.
  const [valueStr, setValueStr] = useState<string>("");
  const [whenLocal, setWhenLocal] = useState<string>(() => toLocalInputValue(new Date()));
  const [note, setNote]         = useState<string>("");
  const [busy, setBusy]         = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [latest, setLatest]     = useState<FingerstickReading | null>(null);
  const [savedTick, setSavedTick] = useState<number>(0);

  const valueId = useId();
  const whenId  = useId();
  const noteId  = useId();

  useEffect(() => {
    fetchLatestFingerstick().then(setLatest).catch(() => {});
  }, []);

  async function handleSave() {
    setFeedback(null);

    // Accept both "127" and "127,5" (German decimal). Empty/garbage
    // input falls through to the same "out of range" error as a value
    // outside 20–600 so we only ever surface one validation message.
    const num = Number((valueStr ?? "").replace(",", "."));
    if (!Number.isFinite(num) || num < 20 || num > 600) {
      hapticError();
      setFeedback({ kind: "err", msg: t("err_value_range") });
      return;
    }

    let measuredAt: string | undefined;
    if (whenLocal) {
      const d = new Date(whenLocal);
      if (isNaN(d.getTime())) {
        hapticError();
        setFeedback({ kind: "err", msg: t("err_invalid_when") });
        return;
      }
      measuredAt = d.toISOString();
    }

    setBusy(true);
    try {
      const saved = await insertFingerstick({
        value_mg_dl: num,
        measured_at: measuredAt,
        notes: note.trim() || null,
      });
      if (num < BG_LOW_TARGET || num > BG_HIGH_TARGET) hapticWarning();
      else                                              hapticSuccess();
      setSavedTick(n => n + 1);
      setLatest(saved);
      setValueStr("");
      setNote("");
      setWhenLocal(toLocalInputValue(new Date()));
      setFeedback({ kind: "ok", msg: t("saved_ok") });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("err_save_failed");
      hapticError();
      setFeedback({ kind: "err", msg });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--surface-soft)",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: "10px 12px",
    color:"var(--text)",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 14,
      padding: "14px 14px 12px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div>
        <div style={{
          fontSize:11, fontWeight:700, letterSpacing:"0.1em",
          color:"var(--text-dim)", textTransform:"uppercase",
        }}>{t("card_eyebrow")}</div>
        <div style={{
          marginTop: 4,
          fontSize: 14, fontWeight: 600, color:"var(--text)", lineHeight: 1.3,
        }}>
          {t("card_title")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor={valueId} style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600, letterSpacing: "0.04em" }}>
            {t("value_label")}
          </label>
          {/* Free-form numeric input (shared NumberField primitive) —
              replaces the previous SnapSlider so the user can type the
              exact value from their meter (e.g. "127") instead of
              dragging a 260-step slider. */}
          <NumberField
            id={valueId}
            value={valueStr}
            onChange={setValueStr}
            min={20}
            max={600}
            step={1}
            unit={t("mgdl_unit")}
            accent={ACCENT}
            ariaLabel={t("value_label")}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor={whenId} style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600, letterSpacing: "0.04em" }}>
            {t("when_label")}
          </label>
          <input
            id={whenId}
            type="datetime-local"
            value={whenLocal}
            onChange={(e) => setWhenLocal(e.target.value)}
            style={inputStyle}
          />
        </div>

        <CollapsibleField
          label={t("note_collapse_label")}
          accent={ACCENT}
          hasValue={note.trim().length > 0}
        >
          <label htmlFor={noteId} style={{ display: "none" }}>{t("note_label")}</label>
          <input
            id={noteId}
            type="text"
            placeholder={t("note_placeholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={inputStyle}
            maxLength={200}
          />
        </CollapsibleField>

        <SaveButton
          onClick={handleSave}
          busy={busy}
          accent={ACCENT}
          label={busy ? t("save_busy") : t("save_idle")}
          successKey={savedTick || null}
        />
        <span
          role="status"
          aria-live="polite"
          style={{
            fontSize: 13, fontWeight: 600,
            color: feedback?.kind === "ok" ? GREEN : PINK,
            minHeight: 16,
          }}
        >
          {feedback?.msg ?? ""}
        </span>
      </div>

      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.4 }}>
        {latest
          ? <>{t("latest_label")}<span style={{ color:"var(--text)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{t("latest_value", { value: Math.round(latest.value_mg_dl) })}</span> · {formatLatestWhen(latest.measured_at)}</>
          : <>{t("no_values")}</>}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.4, fontStyle: "italic" }}>
        {t("footnote")}
      </div>
    </div>
  );
}
