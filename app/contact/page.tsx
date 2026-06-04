"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLocale } from "next-intl";
import Lockup from "@/components/landing/Lockup";
import { ACCENT, ACCENT_HOVER, BG, SURFACE, TEXT_DIM, TEXT_FAINT } from "@/components/landing/tokens";

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

type Content = {
  heading: string;
  sub: string;
  directEmail: string;
  labelName: string;
  optional: string;
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
  backHome: string;
  loading: string;
};

const DE: Content = {
  heading: "Schreib uns",
  sub: "Frag uns alles — Beta-Zugang, Pro, technische Probleme oder einfach Feedback. Wir antworten persönlich.",
  directEmail: "Lieber direkt per Email?",
  labelName: "Name",
  optional: "(optional)",
  labelEmail: "Email",
  labelSubject: "Betreff",
  labelMessage: "Nachricht",
  honeypot: "Website (bitte leer lassen)",
  errorRequired: "Bitte mindestens Email und Nachricht ausfüllen.",
  errorFailed: "Versand fehlgeschlagen.",
  errorNetwork: "Netzwerkfehler. Bitte erneut versuchen oder direkt an hello@glev.app schreiben.",
  sending: "Wird gesendet…",
  send: "Nachricht senden",
  doneHeading: "Nachricht ist raus.",
  doneBody: (email) => (
    <>
      Wir antworten persönlich an <strong style={{ color: "#fff" }}>{email}</strong>, üblicherweise innerhalb
      von 24 Stunden.
    </>
  ),
  backHome: "Zurück zur Startseite",
  loading: "Lädt…",
};

const EN: Content = {
  heading: "Get in touch",
  sub: "Ask us anything — beta access, Pro, technical issues, or just feedback. We reply personally.",
  directEmail: "Prefer email directly?",
  labelName: "Name",
  optional: "(optional)",
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
      We&apos;ll reply personally to <strong style={{ color: "#fff" }}>{email}</strong>, usually within 24 hours.
    </>
  ),
  backHome: "Back to home",
  loading: "Loading…",
};

function ContactForm({ C }: { C: Content }) {
  const params = useSearchParams();
  const sourceParam = params.get("source") ?? "";
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
        body: JSON.stringify({
          name,
          email,
          subject,
          message,
          source: sourceParam || "contact-page",
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || C.errorFailed);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError(C.errorNetwork);
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(34, 211, 160, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
          aria-hidden
        >
          ✓
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{C.doneHeading}</h2>
        <p style={{ fontSize: 15, color: TEXT_DIM, margin: 0, lineHeight: 1.55, maxWidth: 380 }}>
          {C.doneBody(email)}
        </p>
        <Link
          href="/"
          style={{
            marginTop: 8,
            color: TEXT_DIM,
            fontSize: 14,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          {C.backHome}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
      <div>
        <label htmlFor="contact-name" style={lbl}>
          {C.labelName}{" "}
          <span style={{ color: TEXT_FAINT, fontWeight: 400 }}>{C.optional}</span>
        </label>
        <input
          id="contact-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          style={inp}
        />
      </div>

      <div>
        <label htmlFor="contact-email" style={lbl}>{C.labelEmail}</label>
        <input
          id="contact-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={200}
          style={inp}
        />
      </div>

      <div>
        <label htmlFor="contact-subject" style={lbl}>
          {C.labelSubject}{" "}
          <span style={{ color: TEXT_FAINT, fontWeight: 400 }}>{C.optional}</span>
        </label>
        <input
          id="contact-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          style={inp}
        />
      </div>

      <div>
        <label htmlFor="contact-message" style={lbl}>{C.labelMessage}</label>
        <textarea
          id="contact-message"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          maxLength={5000}
          style={{ ...inp, resize: "vertical", minHeight: 140, fontFamily: "inherit", lineHeight: 1.5 }}
        />
      </div>

      {/* Honeypot — versteckt vor echten Usern, Bots füllen es aus */}
      <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }} aria-hidden>
        <label>
          {C.honeypot}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <div
          style={{
            background: "rgba(255, 45, 120, 0.1)",
            border: "1px solid rgba(255, 45, 120, 0.3)",
            color: "#FF7AAA",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: 4,
          background: submitting ? ACCENT_HOVER : ACCENT,
          color: "#fff",
          border: "none",
          padding: "14px 24px",
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 600,
          cursor: submitting ? "wait" : "pointer",
          minHeight: 48,
          transition: "background 120ms ease",
        }}
        onMouseEnter={(e) => {
          if (!submitting) e.currentTarget.style.background = ACCENT_HOVER;
        }}
        onMouseLeave={(e) => {
          if (!submitting) e.currentTarget.style.background = ACCENT;
        }}
      >
        {submitting ? C.sending : C.send}
      </button>
    </form>
  );
}

export default function ContactPage() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: "#fff",
        padding: "64px 20px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
        <Lockup width={160} />

        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: "-0.03em", fontWeight: 700, margin: 0 }}>
            {C.heading}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: TEXT_DIM, margin: 0 }}>
            {C.sub}
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: TEXT_FAINT, margin: 0 }}>
            {C.directEmail}{" "}
            <a
              href="mailto:hello@glev.app"
              style={{ color: TEXT_DIM, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              hello@glev.app
            </a>
          </p>
        </div>

        <div
          style={{
            background: SURFACE,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 24,
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <Suspense fallback={<div style={{ color: TEXT_DIM, fontSize: 14 }}>{C.loading}</div>}>
            <ContactForm C={C} />
          </Suspense>
        </div>

        <Link
          href="/"
          style={{
            fontSize: 13,
            color: TEXT_FAINT,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          ← {C.backHome}
        </Link>
      </div>
    </main>
  );
}
