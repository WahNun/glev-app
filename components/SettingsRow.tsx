"use client";

import type { CSSProperties, ReactNode } from "react";

const BORDER = "var(--border)";
const SURFACE = "var(--surface)";

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * iOS-style grouped section: small uppercase header above a rounded container
 * that hosts one or more SettingsRow children. Rows render their own internal
 * dividers via SettingsRow's borderTop, so this component only wraps the
 * outer container and header.
 */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-faint)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: "0 0 8px 4px",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </section>
  );
}

interface SettingsRowProps {
  /** Brand/accent colour for the leading icon tile. */
  iconColor: string;
  /** SVG glyph rendered inside the icon tile. */
  icon: ReactNode;
  label: string;
  /** Optional secondary line under the label (e.g. current value). */
  subtitle?: string;
  /** Right-side adornment rendered before the chevron (e.g. "Verbunden"). */
  rightAdornment?: ReactNode;
  /** True when this row is the first child — suppresses the top divider. */
  first?: boolean;
  onClick: () => void;
  ariaLabel?: string;
}

export function SettingsRow({
  iconColor,
  icon,
  label,
  subtitle,
  rightAdornment,
  first,
  onClick,
  ariaLabel,
}: SettingsRowProps) {
  const baseStyle: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    border: "none",
    borderTop: first ? "none" : `1px solid ${BORDER}`,
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={baseStyle}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          flexShrink: 0,
          background: `${iconColor}18`,
          color: iconColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text-strong)",
            lineHeight: 1.25,
          }}
        >
          {label}
        </span>
        {subtitle && (
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 2,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {rightAdornment && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            color: "var(--text-dim)",
            fontSize: 12,
          }}
        >
          {rightAdornment}
        </span>
      )}
      <span
        aria-hidden
        style={{
          color: "var(--text-faint)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          marginLeft: 4,
        }}
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 1 7 7 1 13" />
        </svg>
      </span>
    </button>
  );
}

interface ConnectedDotProps {
  label: string;
}

/**
 * Right-side adornment used by CGM rows when the integration is connected.
 * Pairs a small green pulse dot with a localised "Connected" label.
 */
export function ConnectedDot({ label }: ConnectedDotProps) {
  const GREEN = "#22D3A0";
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: GREEN,
          boxShadow: `0 0 0 3px ${GREEN}22`,
        }}
      />
      <span style={{ color: GREEN, fontWeight: 600 }}>{label}</span>
    </>
  );
}
