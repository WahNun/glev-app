import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 80) : "";
  const honeypot = typeof body.website === "string" ? body.website.trim() : "";

  if (honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (!email || !EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
    return NextResponse.json({ error: "Bitte gültige Email-Adresse angeben." }, { status: 400 });
  }
  if (!message || message.length < 5) {
    return NextResponse.json({ error: "Nachricht ist zu kurz." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: "Nachricht ist zu lang (max 5000 Zeichen)." }, { status: 400 });
  }
  if (name.length > MAX_NAME || subject.length > MAX_SUBJECT) {
    return NextResponse.json({ error: "Eingaben zu lang." }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.error("[contact] RESEND_API_KEY not configured");
    return NextResponse.json({ error: "Mail-Service nicht konfiguriert." }, { status: 500 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const safeName = escapeHtml(name || "—");
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject || "(ohne Betreff)");
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const safeSource = escapeHtml(source || "direct");

  const subjectLine = subject
    ? `[Glev Kontakt] ${subject}`
    : `[Glev Kontakt] Neue Nachricht von ${name || email}`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#f9f9f9;padding:24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <tr><td style="background:#0f172a;padding:20px 28px;color:#ffffff;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;">Glev — Kontaktformular</td></tr>
    <tr><td style="padding:24px 28px;">
      <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Von</p>
      <p style="margin:0 0 18px;font-size:16px;"><strong>${safeName}</strong> &lt;${safeEmail}&gt;</p>
      <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Betreff</p>
      <p style="margin:0 0 18px;font-size:16px;">${safeSubject}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Quelle</p>
      <p style="margin:0 0 18px;font-size:14px;color:#475569;"><code>${safeSource}</code></p>
      <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Nachricht</p>
      <div style="margin:0;padding:16px;background:#f1f5f9;border-radius:8px;font-size:15px;line-height:1.5;white-space:pre-wrap;">${safeMessage}</div>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8;">Antworte direkt auf diese Email — sie geht an ${safeEmail}.</td></tr>
  </table>
</body></html>`;

  try {
    await resend.emails.send({
      from: "Glev Kontakt <info@glev.app>",
      to: "hello@glev.app",
      replyTo: email,
      subject: subjectLine,
      html,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[contact] Resend send failed:", err);
    return NextResponse.json({ error: "Versand fehlgeschlagen. Bitte direkt an hello@glev.app schreiben." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
