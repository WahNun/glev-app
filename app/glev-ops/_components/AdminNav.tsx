"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "../_actions";

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
      { href: "/glev-ops/crm", label: "CRM" },
      { href: "/glev-ops/users", label: "Nutzer" },
      { href: "/glev-ops/subscriptions", label: "Abos" },
      { href: "/glev-ops/buyers", label: "Käufer" },
      { href: "/glev-ops/faelle", label: "Fälle" },
      { href: "/glev-ops/praxis", label: "Praxen" },
      { href: "/glev-ops/sms", label: "SMS Test" },
      { href: "/glev-ops/settings", label: "Einstellungen" },
    ],
  },
  {
    label: "E-Mail",
    items: [
      { href: "/glev-ops/drip", label: "Drip-Pipeline" },
      { href: "/glev-ops/drip-stats", label: "Statistik" },
      { href: "/glev-ops/emails", label: "Vorschau" },
      { href: "/glev-ops/outbox", label: "Outbox" },
    ],
  },
  {
    label: "KI",
    items: [
      { href: "/glev-ops/mistral", label: "Mistral TTS" },
    ],
  },
  {
    label: "App",
    items: [
      { href: "/glev-ops/trial-ui", label: "Trial-UI" },
      { href: "/glev-ops/journey", label: "Journey" },
    ],
  },
  {
    label: "Dev",
    items: [
      { href: "/glev-ops/dev-cockpit", label: "Dev Cockpit" },
    ],
  },
];

function isItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function getActiveGroupIndex(pathname: string): number {
  for (let i = 0; i < GROUPS.length; i++) {
    if (GROUPS[i].items.some((it) => isItemActive(pathname, it.href))) {
      return i;
    }
  }
  return 0;
}

export default function AdminNav() {
  const pathname = usePathname() ?? "";
  const activeGroupIndex = getActiveGroupIndex(pathname);
  const activeGroup = GROUPS[activeGroupIndex];

  return (
    <nav aria-label="Admin-Navigation">
      {/* Primary bar — brand + group tabs + logout */}
      <div style={primaryBarStyle}>
        <div style={innerStyle}>
          <Link href="/glev-ops" style={brandStyle}>
            Glev Admin
          </Link>

          <div style={groupTabsStyle}>
            {GROUPS.map((group, gi) => {
              const active = gi === activeGroupIndex;
              return (
                <Link
                  key={group.label}
                  href={group.items[0].href}
                  style={active ? groupTabActiveStyle : groupTabStyle}
                  aria-current={active ? "true" : undefined}
                >
                  {group.label}
                </Link>
              );
            })}
          </div>

          <form action={logoutAction} style={{ marginLeft: "auto" }}>
            <button type="submit" style={logoutBtnStyle}>
              Logout
            </button>
          </form>
        </div>
      </div>

      {/* Secondary bar — sub-tabs of active group */}
      <div style={secondaryBarStyle}>
        <div style={subInnerStyle}>
          {activeGroup.items.map((it) => {
            const active = isItemActive(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                style={active ? subLinkActiveStyle : subLinkStyle}
                aria-current={active ? "page" : undefined}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

const primaryBarStyle: React.CSSProperties = {
  background: "#111",
  color: "#fff",
  borderBottom: "1px solid #1e1e1e",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const innerStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto",
  padding: "0 24px",
  display: "flex",
  alignItems: "stretch",
  gap: 4,
  height: 44,
};

const brandStyle: React.CSSProperties = {
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  letterSpacing: 0.3,
  textDecoration: "none",
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  paddingRight: 16,
};

const groupTabsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 0,
};

const groupTabStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 14px",
  color: "#888",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: "nowrap",
  borderBottom: "2px solid transparent",
  transition: "color 0.15s",
};

const groupTabActiveStyle: React.CSSProperties = {
  ...groupTabStyle,
  color: "#fff",
  borderBottom: "2px solid #3b82f6",
};

const secondaryBarStyle: React.CSSProperties = {
  background: "#0a0a0a",
  borderBottom: "1px solid #222",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const subInnerStyle: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto",
  padding: "0 24px",
  display: "flex",
  alignItems: "stretch",
  gap: 0,
  height: 36,
};

const subLinkStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  color: "#777",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
  borderBottom: "2px solid transparent",
};

const subLinkActiveStyle: React.CSSProperties = {
  ...subLinkStyle,
  color: "#e5e5e5",
  borderBottom: "2px solid #3b82f6",
};

const logoutBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  color: "#666",
  border: "1px solid #333",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  alignSelf: "center",
  marginLeft: 8,
};
