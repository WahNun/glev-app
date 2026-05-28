"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../_actions";

/**
 * Shared top-bar navigation for every authenticated /admin page.
 *
 * Links are grouped into two visual clusters separated by a faint divider:
 *   • Nutzer & Accounts — Nutzer, Abos, Käufer, Fälle, Praxen, Einstellungen
 *   • E-Mail — Drip-Pipeline, Drip-Statistik, Mail-Preview, Mail-Outbox
 *
 * Adding a new page: append to the relevant group in GROUPS below.
 */

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: ReadonlyArray<NavItem>;
}

const GROUPS: ReadonlyArray<NavGroup> = [
  {
    label: "Nutzer & Accounts",
    items: [
      { href: "/admin/users", label: "Nutzer" },
      { href: "/admin/subscriptions", label: "Abos" },
      { href: "/admin/buyers", label: "Käufer" },
      { href: "/admin/faelle", label: "Fälle" },
      { href: "/admin/praxis", label: "Praxen" },
      { href: "/admin/settings", label: "Einstellungen" },
    ],
  },
  {
    label: "E-Mail",
    items: [
      { href: "/admin/drip", label: "Drip-Pipeline" },
      { href: "/admin/drip-stats", label: "Statistik" },
      { href: "/admin/emails", label: "Vorschau" },
      { href: "/admin/outbox", label: "Outbox" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav style={navStyle} aria-label="Admin-Navigation">
      <div style={innerStyle}>
        <Link href="/admin" style={brandStyle}>
          Glev Admin
        </Link>

        <div style={groupsStyle}>
          {GROUPS.map((group, gi) => (
            <div key={group.label} style={groupWrapStyle}>
              {gi > 0 && <span style={dividerStyle} aria-hidden />}
              <span style={groupLabelStyle}>{group.label}</span>
              <ul style={listStyle}>
                {group.items.map((it) => {
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
            </div>
          ))}
        </div>

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
  padding: "8px 24px",
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
};

const brandStyle: React.CSSProperties = {
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: 0.3,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const groupsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 0,
  flexWrap: "wrap",
};

const groupWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const dividerStyle: React.CSSProperties = {
  display: "inline-block",
  width: 1,
  height: 28,
  background: "#333",
  margin: "0 8px",
  flexShrink: 0,
};

const groupLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.8,
  color: "#555",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  paddingRight: 6,
  userSelect: "none",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  gap: 2,
  margin: 0,
  padding: 0,
  flexWrap: "wrap",
};

const linkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "5px 10px",
  color: "#ccc",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 4,
  whiteSpace: "nowrap",
};

const linkActiveStyle: React.CSSProperties = {
  ...linkStyle,
  color: "#fff",
  background: "#2a2a2a",
};

const logoutBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 4,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
