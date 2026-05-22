"use client";

import styles from "./GlevAIButton.module.css";

interface GlevAIButtonProps {
  onPress: () => void;
  isListening?: boolean;
}

/**
 * Glev AI FAB — 64×64 round button with animated visual identity.
 * Replaces the legacy Glev Engine FAB in the mobile bottom nav.
 *
 * Props:
 *   onPress      — called on tap / click
 *   isListening  — activates the fast-pulse listening state (default false)
 *
 * Capacitor-compatible: no Web-only APIs used.
 */
export default function GlevAIButton({ onPress, isListening = false }: GlevAIButtonProps) {
  const containerClass = [styles.btn, isListening ? styles.listening : ""].join(" ").trim();

  return (
    <div
      className={containerClass}
      onClick={onPress}
      role="button"
      tabIndex={0}
      aria-label="Glev AI öffnen"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress(); } }}
    >
      <span className={styles.frame} aria-hidden="true" />
      <span className={styles.sweep} aria-hidden="true" />
      <span className={styles.dots} aria-hidden="true">
        <span className={`${styles.dot} ${styles.dot1}`} />
        <span className={`${styles.dot} ${styles.dot2}`} />
        <span className={`${styles.dot} ${styles.dot3}`} />
      </span>
      <span className={styles.icon} aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="14" fill="rgba(79,110,247,0.12)" />
          <path
            className={styles.iconRing}
            d="M8 14c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6-6-2.7-6-6z"
            fill="white"
            opacity="0.85"
          />
          <circle
            className={styles.iconDot}
            cx="14"
            cy="14"
            r="2.5"
            fill="white"
          />
        </svg>
      </span>
    </div>
  );
}
