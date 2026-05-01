// Layout sibling exists purely so we can keep `metadata` (a server-only API)
// alongside the client-rendered page.tsx. Next.js disallows `export const
// metadata` from a "use client" file, so without this wrapper the /pro/success
// route would lose its custom <title>.
import type { ReactNode } from "react";

export const metadata = {
  title: "Glev Pro — Mitgliedschaft angelegt",
};

export default function ProSuccessLayout({ children }: { children: ReactNode }) {
  return children;
}
