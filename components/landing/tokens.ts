/**
 * Design tokens shared across the public landing pages (/beta, /pro, ...).
 * Single source of truth so the two pages can never visually drift.
 *
 * Surfaces, borders and text colors point at the theme CSS variables
 * defined in `app/globals.css`, so these tokens automatically re-skin
 * when `<html data-theme="light">` is set (Task #42 — Light Mode for the
 * marketing surfaces). Brand accents (ACCENT/MINT/PINK) stay constant
 * across themes per the brand spec.
 */
export const ACCENT = "#4F6EF7";
export const ACCENT_HOVER = "#6B8BFF";
export const MINT = "#22D3A0";
export const PINK = "#FF2D78";

// Theme-aware tokens — resolve at paint via CSS custom properties so the
// landing surfaces follow the same Light/Dark contract as the in-app
// pages. Using `var(--…)` strings here is safe in inline styles and on
// SVG presentation attributes that accept color values.
export const BG = "var(--bg)";
export const SURFACE = "var(--surface)";
export const BORDER = "var(--border)";
export const TEXT = "var(--text)";
export const TEXT_DIM = "var(--text-body)";
export const TEXT_FAINT = "var(--text-dim)";

/** Single source of truth for the public launch date. */
export const LAUNCH_DATE_ISO = "2026-07-01";
export const LAUNCH_DATE_LABEL = "1. Juli 2026";
