"use client";

import React from "react";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const ORANGE = "#FF9500";
const SURFACE = "#111117";
const BG = "#09090B";
const BORDER = "rgba(255,255,255,0.08)";

const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div style={card}>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.3)",
          letterSpacing: "0.07em",
          textTransform: "uppercase" as const,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 36,
          fontWeight: 900,
          letterSpacing: "-0.04em",
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}
      >
        {sub}
      </div>
    </div>
  );
}

function DarkCockpit() {
  return (
    <div
      style={{
        background: BG,
        color: "#fff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        minHeight: "100vh",
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              marginBottom: 4,
            }}
          >
            Dashboard
          </h1>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
            24 meals logged. Click any card to see formula.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
            marginBottom: 22,
          }}
        >
          <StatCard
            label="Control Score"
            value="82"
            sub="out of 100"
            color={ACCENT}
          />
          <StatCard
            label="Good Rate"
            value="71%"
            sub="of logged meals"
            color={GREEN}
          />
          <StatCard
            label="Spike Rate"
            value="17%"
            sub="under-dosed meals"
            color={ORANGE}
          />
          <StatCard
            label="Hypo Risk"
            value="8%"
            sub="over-dosed meals"
            color={PINK}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "3fr 2fr",
            gap: 14,
            marginBottom: 22,
          }}
        >
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Glucose Trend
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.3)",
                marginBottom: 14,
              }}
            >
              Average glucose before meals — last 14 days
            </div>
            <svg viewBox="0 0 480 98" style={{ width: "100%" }}>
              <defs>
                <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[80, 110, 140, 180].map((v) => {
                const y = 90 - ((v - 70) / 160) * 70 - 10;
                return (
                  <g key={v}>
                    <line
                      x1={20}
                      y1={y}
                      x2={460}
                      y2={y}
                      stroke="rgba(255,255,255,0.05)"
                      strokeDasharray="4"
                    />
                    <text
                      x={16}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="8"
                      fill="rgba(255,255,255,0.2)"
                    >
                      {v}
                    </text>
                  </g>
                );
              })}
              <path
                d="M20,45 L55,42 L90,48 L125,40 L160,38 L195,44 L230,35 L265,30 L300,38 L335,42 L370,36 L405,32 L440,28 L460,30 L460,90 L20,90 Z"
                fill="url(#tg)"
              />
              <path
                d="M20,45 L55,42 L90,48 L125,40 L160,38 L195,44 L230,35 L265,30 L300,38 L335,42 L370,36 L405,32 L440,28 L460,30"
                fill="none"
                stroke={ACCENT}
                strokeWidth="2"
                strokeLinecap="round"
              />
              {[
                [20, 45],
                [125, 40],
                [265, 30],
                [370, 36],
                [460, 30],
              ].map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="3"
                  fill={ACCENT}
                  stroke={SURFACE}
                  strokeWidth="1.5"
                />
              ))}
            </svg>
          </div>

          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Outcome Distribution
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.3)",
                marginBottom: 18,
              }}
            >
              All-time breakdown
            </div>
            {[
              { label: "Good", count: 17, pct: 71, color: GREEN },
              { label: "Under Dose", count: 4, pct: 17, color: ORANGE },
              { label: "Over Dose", count: 2, pct: 8, color: PINK },
              { label: "Spike", count: 1, pct: 4, color: "#FF9F0A" },
            ].map((g) => (
              <div key={g.label} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}
                  >
                    {g.label}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: g.color }}>
                    {g.count}{" "}
                    <span
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontWeight: 400,
                      }}
                    >
                      ({g.pct}%)
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 99,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${g.pct}%`,
                      background: g.color,
                      borderRadius: 99,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            ...card,
            padding: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "18px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>Recent Entries</div>
            <span
              style={{
                fontSize: 12,
                color: ACCENT,
                cursor: "pointer",
              }}
            >
              View all →
            </span>
          </div>
          {[
            {
              text: "Oatmeal with banana and honey",
              bg: 98,
              carbs: 94,
              insulin: 6.5,
              eval: "Good",
              color: GREEN,
            },
            {
              text: "Scrambled eggs with whole wheat toast",
              bg: 112,
              carbs: 30,
              insulin: 2.0,
              eval: "Good",
              color: GREEN,
            },
            {
              text: "Pancakes with maple syrup",
              bg: 105,
              carbs: 92,
              insulin: 4.0,
              eval: "Under Dose",
              color: ORANGE,
            },
            {
              text: "Turkey sandwich with apple",
              bg: 118,
              carbs: 53,
              insulin: 3.5,
              eval: "Good",
              color: GREEN,
            },
          ].map((m, i) => (
            <div
              key={i}
              style={{
                padding: "14px 24px",
                borderBottom: `1px solid ${BORDER}`,
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto auto",
                gap: 16,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{m.text}</div>
              <div style={{ fontSize: 13, textAlign: "right" }}>
                <span
                  style={{
                    color: "rgba(255,255,255,0.35)",
                    fontSize: 11,
                  }}
                >
                  BG{" "}
                </span>
                {m.bg}
              </div>
              <div style={{ fontSize: 13, textAlign: "right" }}>
                <span
                  style={{
                    color: "rgba(255,255,255,0.35)",
                    fontSize: 11,
                  }}
                >
                  Carbs{" "}
                </span>
                {m.carbs}g
              </div>
              <div style={{ fontSize: 13, textAlign: "right" }}>
                <span
                  style={{
                    color: "rgba(255,255,255,0.35)",
                    fontSize: 11,
                  }}
                >
                  Insulin{" "}
                </span>
                {m.insulin}u
              </div>
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  background: `${m.color}18`,
                  color: m.color,
                  border: `1px solid ${m.color}30`,
                  whiteSpace: "nowrap" as const,
                }}
              >
                {m.eval}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DarkCockpitPage() { return <DarkCockpit />; }
