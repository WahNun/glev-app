"use client";

import { useEffect } from "react";

/**
 * PreventZoom — disables every flavour of zoom that iOS Safari doesn't
 * already block via the viewport meta:
 *   - WebKit gesture events (pinch-to-zoom on a notched iPhone)
 *   - Double-tap to zoom (any taps within 300ms collapse to a single one)
 *
 * Mount once in the root layout. Renders nothing.
 */
export function PreventZoom() {
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();

    document.addEventListener("gesturestart", prevent);
    document.addEventListener("gesturechange", prevent);
    document.addEventListener("gestureend", prevent);

    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };
    // `passive: false` is required so preventDefault() actually takes effect
    // for the second tap of a double-tap.
    document.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend", prevent);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return null;
}

export default PreventZoom;
