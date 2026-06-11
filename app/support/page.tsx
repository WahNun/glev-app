"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocale } from "next-intl";
import Lockup from "@/components/landing/Lockup";
import {
  ACCENT,
  ACCENT_HOVER,
  BG,
  SURFACE,
  BORDER,
  TEXT_DIM,
  TEXT_FAINT,
  MINT,
} from "@/components/landing/tokens";

// ── Shared input styles ───────────────────────────────────────────────────────
const inp: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#fff",
  fontSize: 15,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
};

const lbl: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: TEXT_DIM,
  marginBottom: 6,
};

// ── i18n content ──────────────────────────────────────────────────────────────
type Lang = {
  heading: string;
  sub: string;
  aiFeedbackBadge: string;
  aiFeedbackHeading: string;
  aiFeedbackBody: string;
  aiFeedbackStep1: string;
  aiFeedbackStep2: string;
  aiFeedbackStep3: string;
  aiFeedbackCta: string;
  emailCta: string;
  emailHelp: string;
  formHeading: string;
  optional: string;
  labelName: string;
  labelEmail: string;
  labelSubject: string;
  labelMessage: string;
  honeypot: string;
  errorRequired: string;
  errorFailed: string;
  errorNetwork: string;
  sending: string;
  send: string;
  doneHeading: string;
  doneBody: (email: string) => React.ReactNode;
  founderHeading: string;
  founderBadge: string;
  founderBody: string;
  founderNote: string;
  communityHeading: string;
  communityItem1Heading: string;
  communityItem1Body: string;
  communityItem2Heading: string;
  communityItem2Body: string;
  roadmapHeading: string;
  roadmapBody: string;
  roadmapCta: string;
  backHome: string;
  loading: string;
};

const DE: Lang = {
  heading: "Support & Feedback",
  sub: "Fragen, Probleme, Ideen — alles willkommen.",
  aiFeedbackBadge: "Empfohlen für App-Feedback",
  aiFeedbackHeading: "Feedback direkt über Glev AI geben",
  aiFeedbackBody:
    "Der schnellste Weg: einfach mit der KI reden. Glev AI speichert dein Feedback strukturiert — so fließt es direkt in die Entwicklung ein.",
  aiFeedbackStep1: "Einstellungen → Glev AI öffnen",
  aiFeedbackStep2: "\"App-Feedback speichern\" aktivieren",
  aiFeedbackStep3: "Mit Glev AI sprechen — einfach sagen, was aufgefallen ist",
  aiFeedbackCta: "Zu Glev AI",
  emailCta: "hello@glev.app schreiben",
  emailHelp: "Öffnet deinen E-Mail-Client",
  formHeading: "Nachricht schreiben",
  optional: "(optional)",
  labelName: "Name",
  labelEmail: "E-Mail",
  labelSubject: "Betreff",
  labelMessage: "Nachricht",
  honeypot: "Website (bitte leer lassen)",
  errorRequired: "Bitte mindestens E-Mail und Nachricht ausfüllen.",
  errorFailed: "Versand fehlgeschlagen.",
  errorNetwork: "Netzwerkfehler. Bitte erneut versuchen oder direkt an hello@glev.app schreiben.",
  sending: "Wird gesendet…",
  send: "Nachricht senden",
  doneHeading: "Nachricht ist raus.",
  doneBody: (email) => (
    <>
      Ich antworte persönlich an <strong style={{ color: "#fff" }}>{email}</strong>, meistens innerhalb von 24 Stunden.
    </>
  ),
  founderHeading: "Direkt vom Gründer",
  founderBadge: "Solo-Projekt",
  founderBody:
    "Ich entwickle Glev aktuell alleine — und gebe wirklich mein Bestes. Feedback nehme ich ernst und versuche es zeitnah umzusetzen, ohne falsche Versprechen zu machen. Transparenz ist mir wichtiger als Marketing-Versprechen.",
  founderNote:
    "Glev ist ein Ein-Personen-Projekt. Antwortzeiten können variieren — aber jede Nachricht wird gelesen.",
  communityHeading: "Wege, mich zu erreichen",
  communityItem1Heading: "Founding Members",
  communityItem1Body:
    "Ab Juli bekommt ihr einen eigenen Slack oder Discord — ob Slack oder Discord, das klären wir gemeinsam. Ihr seid dabei, bevor die Entscheidung fällt.",
  communityItem2Heading: "Alle anderen",
  communityItem2Body:
    "Für Entwicklungs-Feedback bitte primär über Glev AI (oben). Für alles andere: das Formular oder die direkte E-Mail.",
  roadmapHeading: "Roadmap & Feature-Voting",
  roadmapBody:
    "Auf Featurebase siehst du, was gerade bearbeitet wird — und kannst abstimmen, welches Feature als Nächstes kommen soll. Dein Feedback fließt direkt dort ein.",
  roadmapCta: "Roadmap & Voting öffnen",
  backHome: "Zurück zur Startseite",
  loading: "Lädt…",
};

const EN: Lang = {
  heading: "Support & Feedback",
  sub: "Questions, issues, ideas — all welcome.",
  aiFeedbackBadge: "Recommended for app feedback",
  aiFeedbackHeading: "Give feedback directly via Glev AI",
  aiFeedbackBody:
    "The fastest way: just talk to the AI. Glev AI stores your feedback in a structured way — so it flows directly into development.",
  aiFeedbackStep1: "Open Settings → Glev AI",
  aiFeedbackStep2: "Enable \"Save app feedback\"",
  aiFeedbackStep3: "Talk to Glev AI — just say what you noticed",
  aiFeedbackCta: "Go to Glev AI",
  emailCta: "Write to hello@glev.app",
  emailHelp: "Opens your email client",
  formHeading: "Send a message",
  optional: "(optional)",
  labelName: "Name",
  labelEmail: "Email",
  labelSubject: "Subject",
  labelMessage: "Message",
  honeypot: "Website (leave blank)",
  errorRequired: "Please fill in at least your email and message.",
  errorFailed: "Sending failed.",
  errorNetwork: "Network error. Please try again or write directly to hello@glev.app.",
  sending: "Sending…",
  send: "Send message",
  doneHeading: "Message sent.",
  doneBody: (email) => (
    <>
      I&apos;ll reply personally to <strong style={{ color: "#fff" }}>{email}</strong>, usually within 24 hours.
    </>
  ),
  founderHeading: "Straight from the founder",
  founderBadge: "Solo project",
  founderBody:
    "I&apos;m building Glev solo right now — and I&apos;m giving it my best. I take feedback seriously and try to act on it quickly, without making false promises. Transparency matters more to me than marketing speak.",
  founderNote:
    "Glev is a one-person project. Response times may vary — but every message gets read.",
  communityHeading: "Ways to reach me",
  communityItem1Heading: "Founding Members",
  communityItem1Body:
    "From July you'll get your own Slack or Discord — whether it's Slack or Discord, we'll figure that out together. You're in before the decision is made.",
  communityItem2Heading: "Everyone else",
  communityItem2Body:
    "For development feedback, please use Glev AI first (above). For everything else: the form or direct email.",
  roadmapHeading: "Roadmap & Feature voting",
  roadmapBody:
    "On Featurebase you can see what's being worked on — and vote on which feature should come next. Your feedback flows there directly.",
  roadmapCta: "Open roadmap & voting",
  backHome: "Back to home",
  loading: "Loading…",
};

// ── Contact form ──────────────────────────────────────────────────────────────
function ContactForm({ C }: { C: Lang }) {
  const params = useSearchParams();
  const subjectParam = params.get("subject") ?? "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(subjectParam);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!email.trim() || !message.trim()) {
      setError(C.errorRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message, source: "support-page", website }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(data.error || C.errorFailed); setSubmitting(false); return; }
      setDone(true);
    } catch {
      setError(C.errorNetwork);
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", padding: "12px 0" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(34,211,160,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }} aria-hidden>✓</div>
        <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>{C.doneHeading}</p>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.55 }}>{C.doneBody(email)}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
      <div>
        <label htmlFor="sup-name" style={lbl}>{C.labelName} <span style={{ color: TEXT_FAINT, fontWeight: 400 }}>{C.optional}</span></label>
        <input id="sup-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} style={inp} />
      </div>
      <div>
        <label htmlFor="sup-email" style={lbl}>{C.labelEmail}</label>
        <input id="sup-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} style={inp} />
      </div>
      <div>
        <label htmlFor="sup-subject" style={lbl}>{C.labelSubject} <span style={{ color: TEXT_FAINT, fontWeight: 400 }}>{C.optional}</span></label>
        <input id="sup-subject" type="text" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} style={inp} />
      </div>
      <div>
        <label htmlFor="sup-message" style={lbl}>{C.labelMessage}</label>
        <textarea id="sup-message" required value={message} onChange={e => setMessage(e.target.value)} rows={5} maxLength={5000} style={{ ...inp, resize: "vertical", minHeight: 120, lineHeight: 1.5 }} />
      </div>
      {/* Honeypot */}
      <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }} aria-hidden>
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
      </div>
      {error && (
        <div style={{ background: "rgba(255,45,120,0.1)", border: "1px solid rgba(255,45,120,0.3)", color: "#FF7AAA", borderRadius: 10, padding: "10px 14px", fontSize: 13 }} role="alert">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        style={{ marginTop: 4, background: submitting ? ACCENT_HOVER : ACCENT, color: "#fff", border: "none", padding: "14px 24px", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: submitting ? "wait" : "pointer", minHeight: 48, transition: "background 120ms ease" }}
        onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = ACCENT_HOVER; }}
        onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = ACCENT; }}
      >
        {submitting ? C.sending : C.send}
      </button>
    </form>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      borderRadius: 16,
      padding: 24,
      width: "100%",
      boxSizing: "border-box",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── AI Feedback steps ─────────────────────────────────────────────────────────
function Step({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span style={{
        flexShrink: 0,
        width: 24, height: 24, borderRadius: "50%",
        background: `rgba(34,211,160,0.15)`,
        border: `1px solid rgba(34,211,160,0.35)`,
        color: MINT,
        fontSize: 12, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{n}</span>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: TEXT_DIM, paddingTop: 3 }}>{text}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SupportPage() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <main style={{ minHeight: "100vh", background: BG, color: "#fff", padding: "60px 20px 80px" }}>
      <div style={{ maxWidth: 580, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>

        {/* ── Logo ── */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Lockup width={150} />
        </div>

        {/* ── Hero ── */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", margin: 0, lineHeight: 1.15 }}>
            {C.heading}
          </h1>
          <p style={{ fontSize: 16, color: TEXT_DIM, margin: 0, lineHeight: 1.55 }}>{C.sub}</p>
        </div>

        {/* ── AI Feedback (prominent) ── */}
        <Card style={{ border: `1px solid rgba(34,211,160,0.35)`, background: "rgba(34,211,160,0.04)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
                background: "rgba(34,211,160,0.15)", color: MINT,
                padding: "3px 9px", borderRadius: 999, border: `1px solid rgba(34,211,160,0.3)`,
              }}>
                {C.aiFeedbackBadge.toUpperCase()}
              </span>
            </div>
            <div>
              <p style={{ fontWeight: 600, fontSize: 17, margin: "0 0 6px" }}>{C.aiFeedbackHeading}</p>
              <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.6 }}>{C.aiFeedbackBody}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Step n={1} text={C.aiFeedbackStep1} />
              <Step n={2} text={C.aiFeedbackStep2} />
              <Step n={3} text={C.aiFeedbackStep3} />
            </div>
            <Link
              href="/glev-ai"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                gap: 6, background: MINT, color: "#0a1a13",
                fontWeight: 700, fontSize: 14, borderRadius: 10,
                padding: "11px 20px", textDecoration: "none",
                alignSelf: "flex-start",
              }}
            >
              {C.aiFeedbackCta} →
            </Link>
          </div>
        </Card>

        {/* ── Direct email button ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <a
            href="mailto:hello@glev.app"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8, width: "100%",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff", textDecoration: "none",
              fontWeight: 600, fontSize: 15,
              borderRadius: 12, padding: "14px 24px",
              transition: "background 120ms ease",
              boxSizing: "border-box",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.06)"; }}
          >
            <span aria-hidden style={{ fontSize: 18 }}>✉</span>
            {C.emailCta}
          </a>
          <span style={{ fontSize: 12, color: TEXT_FAINT }}>{C.emailHelp}</span>
        </div>

        {/* ── Contact form ── */}
        <Card>
          <p style={{ fontWeight: 600, fontSize: 17, margin: "0 0 20px" }}>{C.formHeading}</p>
          <Suspense fallback={<div style={{ color: TEXT_DIM, fontSize: 14 }}>{C.loading}</div>}>
            <ContactForm C={C} />
          </Suspense>
        </Card>

        {/* ── Founder section ── */}
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>{C.founderHeading}</p>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                background: "rgba(79,110,247,0.15)", color: "#9EB4FF",
                padding: "3px 9px", borderRadius: 999, border: "1px solid rgba(79,110,247,0.3)",
              }}>
                {C.founderBadge.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.65 }}>{C.founderBody}</p>
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10,
                padding: "12px 16px",
                fontSize: 13,
                color: TEXT_FAINT,
                lineHeight: 1.55,
                display: "flex", gap: 10, alignItems: "flex-start",
              }}
            >
              <span aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>ℹ</span>
              {C.founderNote}
            </div>

            {/* Community options */}
            <p style={{ fontWeight: 600, fontSize: 15, margin: "4px 0 0" }}>{C.communityHeading}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Founding members */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, fontSize: 18, width: 32, height: 32,
                  background: "rgba(255,199,0,0.1)", borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>⭐</span>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 3px" }}>{C.communityItem1Heading}</p>
                  <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0, lineHeight: 1.55 }}>{C.communityItem1Body}</p>
                </div>
              </div>
              {/* Everyone else */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, fontSize: 18, width: 32, height: 32,
                  background: "rgba(79,110,247,0.1)", borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>💬</span>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 3px" }}>{C.communityItem2Heading}</p>
                  <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0, lineHeight: 1.55 }}>{C.communityItem2Body}</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Featurebase Roadmap ── */}
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontWeight: 600, fontSize: 17, margin: 0 }}>{C.roadmapHeading}</p>
            <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.65 }}>{C.roadmapBody}</p>
            <a
              href="https://glev.featurebase.app/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                gap: 6,
                background: ACCENT, color: "#fff",
                fontWeight: 700, fontSize: 14,
                borderRadius: 10, padding: "11px 20px",
                textDecoration: "none",
                alignSelf: "flex-start",
                transition: "background 120ms ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = ACCENT_HOVER; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = ACCENT; }}
            >
              {C.roadmapCta} ↗
            </a>
          </div>
        </Card>

        {/* ── Back link ── */}
        <div style={{ textAlign: "center" }}>
          <Link
            href="/"
            style={{ fontSize: 13, color: TEXT_FAINT, textDecoration: "underline", textUnderlineOffset: 2 }}
          >
            ← {C.backHome}
          </Link>
        </div>

      </div>
    </main>
  );
}
