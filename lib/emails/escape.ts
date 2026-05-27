/**
 * Escape HTML special characters before inserting user-supplied strings
 * (e.g. buyer names from Stripe) into email HTML templates.
 *
 * Covers the five characters that can break HTML structure or enable
 * HTML injection: & < > " '
 *
 * Returns null unchanged so callers can keep their existing null-checks.
 */
export function escapeHtml(s: string | null): string | null {
  if (s === null) return null;
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
