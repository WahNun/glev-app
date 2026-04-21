import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { login, isAuthenticated } from "@/lib/auth";
import { GlevLogoMark } from "@/components/logo-mark";

export default function Login() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) setLocation("/");
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    setTimeout(() => {
      const ok = login(password);
      if (ok) {
        setLocation("/");
      } else {
        setError("Incorrect password. Try again.");
        setLoading(false);
      }
    }, 300);
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <GlevLogoMark size={52} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Glev</h1>
            <p className="text-sm text-muted-foreground mt-1">Smart insulin decisions</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">Access password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full h-12 px-4 rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
            />
            {error && (
              <p className="text-xs text-destructive font-medium pt-0.5">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!password || loading}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-base disabled:opacity-40 transition-all hover:opacity-90 active:scale-[0.98]"
          >
            {loading ? "Checking…" : "Continue"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Your data stays on your device.
        </p>
      </div>
    </div>
  );
}
