"use client";

import { createContext, useContext } from "react";
import type { useGlevAI } from "./useGlevAI";

/**
 * Shared context that lets any component in the protected layout tree
 * access the single useGlevAI instance owned by LayoutInner.
 *
 * Pattern:
 *   1. LayoutInner calls useGlevAI() and wraps its render with <GlevAIProvider value={glevAi}>
 *   2. Child pages (e.g. /glev-ai) call useGlevAIContext() to read the shared state.
 *
 * This keeps a single conversation instance alive across route changes —
 * the sheet and the /glev-ai fullscreen page see the same messages.
 */
export type GlevAIContextValue = ReturnType<typeof useGlevAI>;

const GlevAIContext = createContext<GlevAIContextValue | null>(null);

export function GlevAIProvider({
  value,
  children,
}: {
  value: GlevAIContextValue;
  children: React.ReactNode;
}) {
  return <GlevAIContext.Provider value={value}>{children}</GlevAIContext.Provider>;
}

export function useGlevAIContext(): GlevAIContextValue {
  const ctx = useContext(GlevAIContext);
  if (!ctx) throw new Error("useGlevAIContext must be used within GlevAIProvider");
  return ctx;
}
