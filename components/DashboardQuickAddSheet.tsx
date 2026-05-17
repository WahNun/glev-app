"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/BottomSheet";
import { hapticLight } from "@/lib/haptics";
import { useQuickAddVisibleItems, decorateQuickAddHref } from "@/components/quickAddShared";

const TEXT = "var(--text-strong)";
const TEXT_DIM = "var(--text-muted)";
const BORDER = "var(--border)";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Dashboard "+"-Button-Popup. Bottom Sheet auf Mobile, zentriertes
 * Modal auf Desktop (via BottomSheet). Listet exakt dieselben Einträge
 * wie das Header-`QuickAddMenu` — Single Source of Truth ist
 * `useQuickAddVisibleItems`, inklusive Cycle-Gating.
 */
export default function DashboardQuickAddSheet({ open, onClose }: Props) {
  const t = useTranslations("quickAdd");
  const router = useRouter();
  const visibleItems = useQuickAddVisibleItems(open);

  function go(href: string) {
    hapticLight();
    onClose();
    router.push(href);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t("open_aria")} maxWidth={420}>
      <div role="menu" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {visibleItems.map(it => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            onClick={() => go(decorateQuickAddHref(it.href))}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              width: "100%", padding: "12px 12px",
              background: "transparent", border: "none",
              color: TEXT, fontSize: 15, fontWeight: 500,
              cursor: "pointer", textAlign: "left",
              borderRadius: 12,
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{
              width: 36, height: 36, borderRadius: 10,
              background: "var(--surface-soft)",
              border: `1px solid ${BORDER}`,
              color: TEXT_DIM,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {it.icon}
            </span>
            <span>{t(it.key)}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
