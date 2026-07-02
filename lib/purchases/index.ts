"use client";
import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";

let initialized = false;

export async function initPurchases(userId: string | null): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;

  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY;
  if (!apiKey) {
    console.warn("[purchases] NEXT_PUBLIC_REVENUECAT_IOS_KEY missing");
    return;
  }

  await Purchases.configure({
    apiKey,
    appUserID: userId || undefined,
  });
  initialized = true;
}

export interface PurchasesUserAttrs {
  email?: string;
  displayName?: string;
  signupSource?: string;
}

export async function setUserId(userId: string, attrs?: PurchasesUserAttrs): Promise<void> {
  if (!Capacitor.isNativePlatform() || !initialized) return;
  await Purchases.logIn({ appUserID: userId });
  if (attrs?.email) {
    await Purchases.setEmail({ email: attrs.email });
  }
  const displayName = attrs?.displayName || attrs?.email;
  if (displayName) {
    await Purchases.setDisplayName({ displayName });
  }
  await Purchases.setAttributes({
    signup_source: attrs?.signupSource ?? "app_store_organic",
  });
}

export async function clearUser(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !initialized) return;
  await Purchases.logOut();
}
