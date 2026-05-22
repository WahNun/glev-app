"use client";

import styles from "./GlevAIButton.module.css";
import GlevLogo from "./GlevLogo";

interface GlevAIButtonProps {
  onPress: () => void;
  isListening?: boolean;
}

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
        <GlevLogo size={30} color="white" bg="transparent" />
      </span>
    </div>
  );
}
