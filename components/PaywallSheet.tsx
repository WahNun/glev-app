"use client";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  Purchases,
  type PurchasesPackage,
  type PurchasesOffering,
} from "@revenuecat/purchases-capacitor";
import BottomSheet from "@/components/BottomSheet";

const ACCENT = "#4F6EF7";
const PURPLE = "#A78BFA";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PaywallSheet({ open, onClose }: Props) {
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!open || !isNative) return;
    Purchases.getOfferings()
      .then((r) => setOffering(r.current ?? null))
      .catch((e) => console.warn("[PaywallSheet] getOfferings failed:", e));
  }, [open, isNative]);

  async function buy(pkg: PurchasesPackage) {
    if (purchasing) return;
    setPurchasing(pkg.identifier);
    try {
      const result = await Purchases.purchasePackage({ aPackage: pkg });
      const active = result.customerInfo.entitlements.active;
      if (active.glev_smart || active.glev_pro) {
        onClose();
      }
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean | null };
      if (!err.userCancelled) {
        console.error("[PaywallSheet] purchase error", e);
      }
    } finally {
      setPurchasing(null);
    }
  }

  async function restore() {
    if (purchasing) return;
    setPurchasing("restore");
    try {
      const r = await Purchases.restorePurchases();
      const active = r.customerInfo.entitlements.active;
      if (active.glev_smart || active.glev_pro) {
        onClose();
      }
    } catch (e) {
      console.warn("[PaywallSheet] restore failed:", e);
    } finally {
      setPurchasing(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Glev Premium">
      {!isNative ? null : !offering ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
          Lade Angebote …
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {offering.availablePackages.map((pkg) => {
            const isBusy = purchasing === pkg.identifier;
            const hasIntro = !!pkg.product.introPrice;
            return (
              <button
                key={pkg.identifier}
                type="button"
                onClick={() => void buy(pkg)}
                disabled={!!purchasing}
                style={{
                  width: "100%",
                  padding: "16px 18px",
                  background: isBusy ? `${ACCENT}88` : ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 13,
                  textAlign: "left",
                  cursor: purchasing ? "default" : "pointer",
                  fontFamily: "inherit",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: hasIntro ? 3 : 0 }}>
                  {isBusy ? "Weiterleitung …" : `${pkg.product.title} — ${pkg.product.priceString}`}
                </div>
                {hasIntro && pkg.product.introPrice && (
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {pkg.product.introPrice.periodNumberOfUnits}-{pkg.product.introPrice.periodUnit.toLowerCase()} kostenlos testen
                  </div>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void restore()}
            disabled={!!purchasing}
            style={{
              width: "100%",
              padding: "13px 0",
              background: "transparent",
              color: "var(--text-faint)",
              border: "1px solid var(--border)",
              borderRadius: 11,
              fontSize: 13,
              cursor: purchasing ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {purchasing === "restore" ? "Wird gesucht …" : "Käufe wiederherstellen"}
          </button>

          <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5, marginTop: 4 }}>
            Durch den Kauf stimmst du den{" "}
            <a href="https://glev.app/legal?tab=agb" style={{ color: PURPLE, textDecoration: "none" }}>
              Nutzungsbedingungen
            </a>{" "}
            und der{" "}
            <a href="https://glev.app/legal?tab=datenschutz" style={{ color: PURPLE, textDecoration: "none" }}>
              Datenschutzerklärung
            </a>{" "}
            zu. Abos verlängern sich automatisch bis zur Kündigung.
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
