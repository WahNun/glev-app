import React from "react";
import { Link, useLocation } from "wouter";
import { Activity, Plus, Upload, Lightbulb, Zap, List } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/log", label: "Quick Log", icon: Plus },
  { href: "/entries", label: "Entry Log", icon: List },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/recommend", label: "Decision Support", icon: Zap },
  { href: "/import", label: "Import Data", icon: Upload },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-foreground">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
              <Activity className="w-5 h-5" />
            </div>
            GlucoJack
          </Link>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Top Navbar (Mobile) */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
            <Activity className="w-4 h-4" />
          </div>
          GlucoJack
        </Link>
      </header>
      
      {/* Bottom Nav (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50 flex items-center justify-around p-2 pb-safe">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-md text-[10px] font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="w-5 h-5 mb-1" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Main Content */}
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>
    </div>
  );
}
