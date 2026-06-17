"use client";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Purchases, type CustomerInfo, type PurchasesCallbackId } from "@revenuecat/purchases-capacitor";

export type SubStatus = {
  loading: boolean;
  hasSmart: boolean;
  hasPro: boolean;
  activeProductIdentifier: string | null;
};

export function useSubscriptionStatus(): SubStatus {
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setLoading(false);
      return;
    }

    let callbackId: PurchasesCallbackId | null = null;

    Purchases.getCustomerInfo()
      .then((r) => setInfo(r.customerInfo))
      .catch(() => {})
      .finally(() => setLoading(false));

    Purchases.addCustomerInfoUpdateListener((customerInfo) => {
      setInfo(customerInfo);
    }).then((id) => {
      callbackId = id;
    }).catch(() => {});

    return () => {
      if (callbackId) {
        Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: callbackId }).catch(() => {});
      }
    };
  }, []);

  return {
    loading,
    hasSmart: !!info?.entitlements?.active?.glev_smart,
    hasPro: !!info?.entitlements?.active?.glev_pro,
    activeProductIdentifier:
      info?.entitlements?.active?.glev_pro?.productIdentifier ??
      info?.entitlements?.active?.glev_smart?.productIdentifier ??
      null,
  };
}
