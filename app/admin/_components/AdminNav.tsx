"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../_actions";

/**
 * Shared top-bar navigation for every authenticated /admin page
 * (Task #171).
 *
 * Why this exists: before this component the four admin pages
 * (buyers / drip / drip-stats / emails) had no chrome connecting
 * them — operators had to memorise each URL. The cookie was already
 * scoped to "/admin" so a single login covers all of them; this nav
 * just makes that fact visible in the UI.
 *
 * Adding a fifth admin page from now on means appending one row to
 * the ITEMS array. The active-link highlight uses `usePathname` so
 * the nav also renders correctly inside Next.js' app router without
 * any per-page prop wiring.
 *
 * Mounted by `app/admin/layout.tsx` only when `isAdminAuthed()` is
 * true — so unauthenticated visitors keep seeing the bare login form.
 */

const ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin/buyers", label: "Käufer" },
  { href: "/admin/drip", label: "Drip-Pipeline" },
  { href: "/admin/drip-stats", label: "Drip-Statistik" },
  { href: "/admin/emails", label: "Mail-Preview" },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav style={navStyle} aria-label="Admin-Navigation">
      <div style={innerStyle}>
        <Link href="/admin" style={brandStyle}>
          Glev Admin
        </Link>
        <ul style={listStyle}>
          {ITEMS.map((it) => {
            // Mark the link active for an exact match or any nested
            // route ("/admin/buyers/123" should still highlight
            // "Käufer"). Trailing-slash guard avoids "/admin/drip"
            // matching "/admin/drip-stats".
            const active =
              pathname === it.href || pathname.startsWith(it.href + "/");
            return (
              <li key={it.href} style={{ listStyle: "none" }}>
                <Link
                  href={it.href}
                  style={active ? linkActiveStyle : linkStyle}
                  aria-current={active ? "page" : undefined}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <form action={logoutAction} style={{ marginLeft: "auto" }}>
          <button type="submit" style={logoutBtnStyle}>
            Logout
          </button>
        </form>
      </div>
    </nav>
  );
}

const navStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  borderBottom: "1px solid #222",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const innerStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto",
  padding: "10px 24px",
  display: "flex",
  alignItems: "center",
  gap: 24,
  flexWrap: "wrap",
};

const brandStyle: React.CSSProperties = {
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: 0.3,
  textDecoration: "none",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  margin: 0,
  padding: 0,
  flexWrap: "wrap",
};

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 12px",
  color: "#ccc",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 4,
};

const linkActiveStyle: React.CSSProperties = {
  ...linkStyle,
  color: "#fff",
  background: "#2a2a2a",
};

const logoutBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};
