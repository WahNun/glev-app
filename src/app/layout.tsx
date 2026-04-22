import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glev",
  description: "Type 1 Diabetes insulin decision-support app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
