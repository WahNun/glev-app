import React from "react";
import { Link, useLocation } from "wouter";
import { Plus, Upload, Lightbulb, Zap, List, Mic, LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlevLogoMark } from "@/components/logo-mark";
import { logout } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/log", label: "Quick Log", icon: Plus },
  { href: "/entries", label: "Entry Log", icon: List },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/recommend", label: "Glev Engine", icon: Zap },
  { href: "/voice", label: "Voice Log", icon: Mic },
  { href: "/import", label: "Import Data", icon: Upload },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  function handleLogout() {
    logout();
    setLocation("/login");
  }

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-xl tracking-tight text-foreground">
            <GlevLogoMark size={32} />
            <span>Glev</span>
          </Link>
          <p className="text-[11px] text-muted-foreground mt-1.5 ml-10">Smart insulin decisions</p>
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

        {/* Logout — desktop sidebar */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Top Navbar (Mobile) */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
          <GlevLogoMark size={28} />
          <span>Glev</span>
        </Link>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">Smart insulin decisions</p>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Bottom Nav (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50 flex items-center justify-around p-2 pb-safe">
        {NAV_ITEMS.filter(i => i.href !== "/import").map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          if (item.href === "/voice") {
            return (
              <Link key={item.href} href={item.href} className="flex flex-col items-center justify-center -mt-6">
                <div className={cn(
                  "w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all",
                  isActive ? "bg-primary scale-105" : "bg-primary"
                )}>
                  <Mic className="w-6 h-6 text-primary-foreground" />
                </div>
              </Link>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-md text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
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
