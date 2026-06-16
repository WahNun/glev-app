"use client";

import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Returns true when running inside the iOS/Android native Capacitor shell.
 * Uses useState + useEffect so SSR and client initial render both return false,
 * avoiding hydration mismatches. Value updates after mount (~1 frame).
 */
export function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
  }, []);
  return native;
}
