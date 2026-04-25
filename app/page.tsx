"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import GlevLockup from "@/components/GlevLockup";

const ACCENT  = "#4F6EF7";
const HOVER   = "#6B8BFF";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const BG      = "#09090B";
const SURFACE = "#111117";
const SURF2   = "#0F0F14";
const BORDER  = "rgba(255,255,255,0.08)";

const SLIDES = [
  {
    src: "/mockups/dashboard.png",
    label: "Dashboard",
    caption: "Glukose live, Today's Macros, Control-Score.",
  },
  {
    src: "/mockups/engine.png",
    label: "Glev Engine",
    caption: "Sprich deine Mahlzeit — Glev parst Makros per KI.",
  },
  {
    src: "/mockups/insights.png",
    label: "Insights",
    caption: "20 Mahlzeiten analysiert · 7-Tage-Trend.",
  },
  {
    src: "/mockups/entries.png",
    label: "Entry Log",
    caption: "Chronologisches Log — jede Mahlzeit ein Tap.",
  },
];

const ROTATE_MS = 4500;

export default function Home() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (paused) return;
    timer.current = setTimeout(() => {
      setIdx((i) => (i + 1) % SLIDES.length);
    }, ROTATE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [idx, paused]);

  function go(n: number) {
    setIdx((n + SLIDES.length) % SLIDES.length);
  }

  return (
    <main
      style={{
        background: BG,
        color: "#fff",
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Soft brand glow background */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 60% at 80% 0%, rgba(79,110,247,0.18) 0%, rgba(79,110,247,0) 60%), radial-gradient(50% 50% at 0% 100%, rgba(34,211,160,0.10) 0%, rgba(34,211,160,0) 60%)",
          pointerEvents: "none",
        }}
      />

      <style>{`
        @keyframes glevSlideIn {
          from { opacity: 0; transform: scale(1.02); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes glevPulse {
          0%,100% { box-shadow: 0 0 0 0 ${ACCENT}55; }
          70%     { box-shadow: 0 0 0 12px ${ACCENT}00; }
        }
        .glev-cta-primary { transition: transform 0.15s, box-shadow 0.15s, background 0.15s; }
        .glev-cta-primary:hover { transform: translateY(-1px); background: ${HOVER}; box-shadow: 0 8px 24px ${ACCENT}55; }
        .glev-cta-ghost { transition: background 0.15s, border-color 0.15s; }
        .glev-cta-ghost:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.18); }
        .glev-link { transition: color 0.15s; }
        .glev-link:hover { color: ${HOVER} !important; }
        .glev-hero {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 64px;
          align-items: center;
        }
        .glev-feat-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }
        .glev-phone-stage { justify-self: end; }
        @media (max-width: 960px) {
          .glev-hero { grid-template-columns: 1fr; gap: 48px; }
          .glev-phone-stage { justify-self: center; }
          .glev-feat-grid { grid-template-columns: 1fr; }
          .glev-h1 { font-size: clamp(40px, 11vw, 64px) !important; }
        }
      `}</style>

      {/* TOP NAV */}
      <nav
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "22px 24px",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }} aria-label="Glev home">
          <GlevLockup size={28} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Link
            href="/brand"
            className="glev-link"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "rgba(255,255,255,0.55)",
              textDecoration: "none",
              letterSpacing: "-0.005em",
            }}
          >
            Brand
          </Link>
          <Link
            href="/login"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              textDecoration: "none",
              padding: "9px 16px",
              borderRadius: 999,
              border: `1px solid ${BORDER}`,
              background: "rgba(255,255,255,0.03)",
            }}
            className="glev-cta-ghost"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "32px 24px 80px",
        }}
      >
        <div className="glev-hero">
          {/* LEFT: copy */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: `${GREEN}14`,
                border: `1px solid ${GREEN}30`,
                color: GREEN,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 24,
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: 99,
                  background: GREEN, animation: "glevPulse 2s ease-out infinite",
                }}
              />
              Private Beta · CGM Live
            </div>

            <h1
              className="glev-h1"
              style={{
                fontSize: "clamp(48px, 7.2vw, 84px)",
                fontWeight: 700,
                letterSpacing: "-0.035em",
                lineHeight: 1.02,
                margin: 0,
                color: "#fff",
              }}
            >
              Typ 1.<br />
              Neu gedacht<span style={{ color: GREEN }}>.</span>
            </h1>

            <p
              style={{
                marginTop: 24,
                fontSize: 18,
                lineHeight: 1.55,
                color: "rgba(255,255,255,0.7)",
                maxWidth: 520,
              }}
            >
              Sprich deine Mahlzeit. Glev liefert Makros per KI, vergleicht
              live mit deinem CGM und dokumentiert alles in einer Sekunde —
              gebaut von einem T1D, weil bestehende Apps zu langsam waren.
            </p>

            <div
              style={{
                marginTop: 32,
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <Link
                href="/login"
                className="glev-cta-primary"
                style={{
                  padding: "14px 22px",
                  borderRadius: 12,
                  background: ACCENT,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: `0 6px 18px ${ACCENT}40`,
                }}
              >
                App öffnen
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </Link>

              <Link
                href="/brand"
                className="glev-cta-ghost"
                style={{
                  padding: "14px 22px",
                  borderRadius: 12,
                  background: "transparent",
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  border: `1px solid ${BORDER}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Brand-System
              </Link>
            </div>

            <div
              style={{
                marginTop: 28,
                display: "inline-flex",
                alignItems: "center",
                gap: 14,
                fontFamily: "var(--font-mono), JetBrains Mono, monospace",
                fontSize: 12,
                color: "rgba(255,255,255,0.45)",
              }}
            >
              <span style={{ color: GREEN }}>● Libre 2</span>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>○ Dexcom</span>
              <span>·</span>
              <span style={{ color: "rgba(255,255,255,0.35)" }}>○ Nightscout</span>
            </div>
          </div>

          {/* RIGHT: iPhone with carousel */}
          <div className="glev-phone-stage">
            <PhoneCarousel
              slides={SLIDES}
              idx={idx}
              onSelect={go}
              onPause={() => setPaused(true)}
              onResume={() => setPaused(false)}
            />
          </div>
        </div>

        {/* FEATURE TRIO */}
        <div className="glev-feat-grid" style={{ marginTop: 80 }}>
          <FeatureCard
            color={ACCENT}
            title="Sprich, statt zu tippen"
            text={`Voice-Input, KI-Parser. „Pasta mit Tomatensauce, 80 g Nudeln und ein Apfel." → Makros in 2 s.`}
          />
          <FeatureCard
            color={GREEN}
            title="CGM live im Loop"
            text="FreeStyle Libre 2 ist verbunden. Glukose wird parallel zum Log gespeichert — pre-meal & post-meal."
          />
          <FeatureCard
            color={ORANGE}
            title="Dokumentation, kein Coach"
            text="Glev rechnet keine Insulin-Dosen. Alles bleibt eine Tracking-App — Therapie macht der Arzt."
          />
        </div>
      </section>

      {/* FOOTER */}
      <footer
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 24px 36px",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "rgba(255,255,255,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GlevLockup size={20} color="rgba(255,255,255,0.7)" />
          <span>© 2026 Glev · hello@glev.app</span>
        </div>
        <div style={{ maxWidth: 560, lineHeight: 1.5 }}>
          Glev ist ein Dokumentations- und Organisations-Tool, kein
          Medizinprodukt. Therapieentscheidungen triffst du in Absprache mit
          deinem Arzt.
        </div>
      </footer>
    </main>
  );
}

/* ---------- iPhone-style carousel ---------- */

type Slide = { src: string; label: string; caption: string };

function PhoneCarousel({
  slides,
  idx,
  onSelect,
  onPause,
  onResume,
}: {
  slides: Slide[];
  idx: number;
  onSelect: (n: number) => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const FRAME_W = 320;
  const FRAME_H = 660;
  const BEZEL = 12;

  return (
    <div
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
      }}
    >
      <div
        style={{
          position: "relative",
          width: FRAME_W,
          height: FRAME_H,
          borderRadius: 56,
          background: "linear-gradient(145deg, #1c1c22 0%, #0a0a0e 50%, #18181d 100%)",
          padding: BEZEL,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1.5px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.10) inset, 0 -2px 6px rgba(255,255,255,0.04) inset, 0 60px 100px -40px rgba(79,110,247,0.25)",
        }}
      >
        {/* Outer rim highlight */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: 55,
            border: "1px solid rgba(255,255,255,0.05)",
            pointerEvents: "none",
          }}
        />

        {/* Side buttons */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: -2,
            top: 110,
            width: 3,
            height: 28,
            background: "#0a0a0e",
            borderRadius: "2px 0 0 2px",
            boxShadow: "inset -1px 0 0 rgba(255,255,255,0.08)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: -2,
            top: 158,
            width: 3,
            height: 48,
            background: "#0a0a0e",
            borderRadius: "2px 0 0 2px",
            boxShadow: "inset -1px 0 0 rgba(255,255,255,0.08)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: -2,
            top: 218,
            width: 3,
            height: 48,
            background: "#0a0a0e",
            borderRadius: "2px 0 0 2px",
            boxShadow: "inset -1px 0 0 rgba(255,255,255,0.08)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -2,
            top: 180,
            width: 3,
            height: 70,
            background: "#0a0a0e",
            borderRadius: "0 2px 2px 0",
            boxShadow: "inset 1px 0 0 rgba(255,255,255,0.08)",
          }}
        />

        {/* Screen */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 44,
            overflow: "hidden",
            background: "#000",
          }}
        >
          {slides.map((s, i) => (
            <img
              key={s.src}
              src={s.src}
              alt={s.label}
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: i === idx ? 1 : 0,
                transition: "opacity 0.55s ease",
                animation: i === idx ? "glevSlideIn 0.55s ease" : undefined,
                pointerEvents: i === idx ? "auto" : "none",
              }}
            />
          ))}

          {/* Dynamic Island */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform: "translateX(-50%)",
              width: 108,
              height: 28,
              borderRadius: 999,
              background: "#000",
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.5)",
              zIndex: 5,
            }}
          />

          {/* Subtle screen reflection */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 44,
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.04) 100%)",
              pointerEvents: "none",
              zIndex: 6,
            }}
          />
        </div>

        {/* Prev / next arrow buttons */}
        <button
          onClick={() => onSelect(idx - 1)}
          aria-label="Previous screenshot"
          style={{
            position: "absolute",
            left: -54,
            top: "50%",
            transform: "translateY(-50%)",
            width: 38,
            height: 38,
            borderRadius: 99,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${BORDER}`,
            color: "rgba(255,255,255,0.7)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="glev-cta-ghost"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          onClick={() => onSelect(idx + 1)}
          aria-label="Next screenshot"
          style={{
            position: "absolute",
            right: -54,
            top: "50%",
            transform: "translateY(-50%)",
            width: 38,
            height: 38,
            borderRadius: 99,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${BORDER}`,
            color: "rgba(255,255,255,0.7)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="glev-cta-ghost"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Caption + dots */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: ACCENT,
            textTransform: "uppercase",
          }}
        >
          {slides[idx].label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            textAlign: "center",
            maxWidth: 280,
            lineHeight: 1.5,
            minHeight: 36,
          }}
        >
          {slides[idx].caption}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => onSelect(i)}
              aria-label={`Show ${slides[i].label}`}
              style={{
                width: i === idx ? 22 : 7,
                height: 7,
                borderRadius: 99,
                border: "none",
                background: i === idx ? ACCENT : "rgba(255,255,255,0.16)",
                cursor: "pointer",
                transition: "width 0.25s, background 0.25s",
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  color,
  title,
  text,
}: {
  color: string;
  title: string;
  text: string;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: "22px 22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: `${color}18`,
          border: `1px solid ${color}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 99, background: color, display: "block" }} />
      </div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          margin: 0,
          color: "#fff",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        {text}
      </p>
    </div>
  );
}
