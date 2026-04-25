"use client";

import { useEffect, useRef, useState } from "react";
import AppMockupPhone from "@/components/AppMockupPhone";

/**
 * FeatureLiveMockup — responsive live mockup for marketing feature cards.
 *
 *  - Desktop viewport (>720px): renders the dark-cockpit page in an
 *    <iframe>, locked to the requested page via URL params (?embed=1
 *    hides the View Toggle and the sidebar nav so visitors stay on
 *    the focused page). The iframe is rendered at native 1180×720 and
 *    CSS-scaled via ResizeObserver so it always fills its container
 *    cleanly without losing click fidelity.
 *
 *  - Mobile viewport (≤720px): renders <AppMockupPhone> locked to the
 *    requested tab. Within-tab interactions still work (card flips,
 *    sub-toggles, expand/collapse) — just no nav between tabs.
 *
 * Only one of the two is mounted at a time, so we don't pay for both
 * an iframe and a phone simultaneously when only one is visible.
 */

type DesktopPage =
  | "dashboard"
  | "log"
  | "entries"
  | "insights"
  | "recommend"
  | "import"
  | "profile";

type MobileTab =
  | "dashboard"
  | "entries"
  | "engine"
  | "insights"
  | "settings";

const DESKTOP_W = 1180;
const DESKTOP_H = 720;

export default function FeatureLiveMockup({
  desktopPage,
  mobileTab,
  label,
}: {
  desktopPage: DesktopPage;
  mobileTab: MobileTab;
  label: string;
}) {
  const [mode, setMode] = useState<"desktop" | "mobile" | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setMode(mq.matches ? "mobile" : "desktop");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Initial render before media query resolves on the client — render
  // a placeholder with the desktop aspect ratio so layout stays stable
  // and we avoid a CLS jump when the real mockup mounts.
  if (mode === null) {
    return (
      <div
        aria-hidden
        style={{
          width: "100%",
          aspectRatio: `${DESKTOP_W} / ${DESKTOP_H}`,
          borderRadius: 14,
          background: "#0F0F14",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      />
    );
  }

  if (mode === "desktop") {
    return <DesktopIframe page={desktopPage} title={label} />;
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <AppMockupPhone lockTab={mobileTab} />
    </div>
  );
}

function DesktopIframe({ page, title }: { page: DesktopPage; title: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setScale(w / DESKTOP_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const src = `/mockups/dark-cockpit?embed=1&view=desktop&page=${page}`;

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        aspectRatio: `${DESKTOP_W} / ${DESKTOP_H}`,
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#0F0F14",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55), 0 4px 12px rgba(79,110,247,0.10)",
      }}
    >
      <iframe
        src={src}
        title={title}
        loading="lazy"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: DESKTOP_W,
          height: DESKTOP_H,
          border: 0,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          background: "#09090B",
        }}
      />
    </div>
  );
}
