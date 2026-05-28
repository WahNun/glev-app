"use client";

import styles from "./GlevAIButton.module.css";

interface GlevAIButtonProps {
  onPress: () => void;
  isListening?: boolean;
  isSpeaking?: boolean;
}

export default function GlevAIButton({ onPress, isListening = false, isSpeaking = false }: GlevAIButtonProps) {
  const containerClass = [
    styles.btn,
    isListening ? styles.listening : "",
    !isListening && isSpeaking ? styles.speaking : "",
  ].join(" ").trim();

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
          <path d="M7 14h3.5l2-5.5 3 11 2-8 1.5 2.5H21" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="14" cy="14" r="2.5" fill="white" />
        </svg>
      </span>
    </div>
  );
}
