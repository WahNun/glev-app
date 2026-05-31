#!/usr/bin/env node
// Einmalig-Script: sendet gebrandete Einladungs-Emails an Meta-Leads
// die bereits in Supabase existieren, aber die hässliche Default-Email bekommen haben.
//
// Aufruf:
//   ADMIN_API_SECRET=xxx node scripts/resend-meta-invites.mjs
//
// Optional: eigene Leads als Argumente übergeben (email:name:locale)
//   node scripts/resend-meta-invites.mjs "max@example.com:Max Mustermann:de"

const BASE_URL = process.env.APP_URL || "https://glev.app";
const SECRET = process.env.ADMIN_API_SECRET;

if (!SECRET) {
  console.error("❌  ADMIN_API_SECRET ist nicht gesetzt.");
  console.error("    Aufruf: ADMIN_API_SECRET=xxx node scripts/resend-meta-invites.mjs");
  process.exit(1);
}

// ── Leads hier eintragen ──────────────────────────────────────────────────────
const LEADS = [
  // Marco, Thomas, Georg haben bereits heute eine gebrandete Email bekommen.
  { email: "susannegoll19691@web.de",   name: "Susanne", locale: "de" },
  { email: "tsonioivanov654@gmail.com", name: "Tsonuy",  locale: "de" },
  { email: "hcmohr@mac.com",            name: "H_C_M",   locale: "de" },
];
// ─────────────────────────────────────────────────────────────────────────────

// Leads können auch als CLI-Argumente übergeben werden: "email:name:locale"
const cliLeads = process.argv.slice(2).map((arg) => {
  const [email, name = "", locale = "de"] = arg.split(":");
  return { email: email.trim(), name: name.trim() || null, locale };
});

const allLeads = [...LEADS, ...cliLeads];

if (allLeads.length === 0) {
  console.error("❌  Keine Leads angegeben. Trag sie in LEADS[] ein oder übergib sie als Argumente.");
  process.exit(1);
}

for (const lead of allLeads) {
  const { email, name, locale = "de" } = lead;
  process.stdout.write(`→ Sende an ${email} ...`);

  try {
    const res = await fetch(`${BASE_URL}/api/admin/meta/resend-invite`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, name: name || null, locale }),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      console.log(` ✅  verschickt (${locale})`);
    } else {
      console.log(` ❌  Fehler ${res.status}: ${json.error ?? JSON.stringify(json)}`);
    }
  } catch (err) {
    console.log(` ❌  Netzwerk-Fehler: ${err.message}`);
  }
}
