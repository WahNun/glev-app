"use client";

// Small icon button that cycles through the three theme choices:
//   dark → light → system → dark
//
// Shows the icon for the CURRENT choice (moon = dark, sun = light,
// monitor = system) so the user always sees what is active and can
// predict what clicking will do (the aria-label names the NEXT state).
//
// Works on both public/marketing pages and the protected in-app area.
// Uses useTheme() from ThemeProvider which is mounted at the root layout.

import { useTheme } from "@/components/ThemeProvider";
import type { ThemeChoice } from "@/lib/theme";

const CYCLE: ThemeChoice[] = ["dark", "light", "system"];

function MoonIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MonitorIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

const NEXT_LABEL: Record<ThemeChoice, string> = {
  dark:   "Zu Hell-Modus wechseln",
  light:  "Zu System-Design wechseln",
  system: "Zu Dunkel-Modus wechseln",
};

interface ThemeToggleProps {
  /** Icon size in px. Defaults to 16. */
  size?: number;
  /** Extra inline styles for the button. */
  style?: React.CSSProperties;
}

export default function ThemeToggle({ size = 16, style }: ThemeToggleProps) {
  const { choice, setChoice } = useTheme();

  function handleClick() {
    const idx = CYCLE.indexOf(choice);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setChoice(next);
  }

  const Icon = choice === "light" ? SunIcon : choice === "system" ? MonitorIcon : MoonIcon;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={NEXT_LABEL[choice]}
      title={NEXT_LABEL[choice]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-soft)",
        color: "var(--text-dim)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      <Icon size={size} />
    </button>
  );
}
