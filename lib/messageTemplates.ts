import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type MessageTemplate = {
  key: string;
  label: string;
  sms_text: string | null;
  email_subject: string | null;
  email_intro: string | null;
  updated_at: string | null;
};

// Hardcoded fallbacks — used when the DB row doesn't exist or a field is null.
// Must stay in sync with the SQL seed in 20260603_message_templates.sql.
const DEFAULTS: Record<string, MessageTemplate> = {
  meta_lead_invite_sms: {
    key: "meta_lead_invite_sms",
    label: "Meta Lead — Einladung (SMS)",
    sms_text:
      "Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.",
    email_subject: null,
    email_intro: null,
    updated_at: null,
  },
  meta_lead_bulk_sms: {
    key: "meta_lead_bulk_sms",
    label: "Meta Lead — Bulk-SMS",
    sms_text:
      "Willkommen bei Glev! Aktiviere deinen kostenlosen 7-Tage-Test: {{link}}\n\nAlternativ kannst du dich auch per E-Mail anmelden – bitte prüfe ggf. auch deinen Spam-Ordner auf eine E-Mail von info@glev.app.",
    email_subject: null,
    email_intro: null,
    updated_at: null,
  },
  meta_lead_reminder_sms: {
    key: "meta_lead_reminder_sms",
    label: "Meta Lead — Reminder (SMS)",
    sms_text:
      "Hast du Glev noch nicht ausprobiert? Als T1D-Nutzer:in hilft dir Glev dabei, deine Insulindosierung besser einzuschätzen. Dein kostenloser 7-Tage-Test: {{link}}\n\nFragen? Antworte einfach auf diese SMS.",
    email_subject: null,
    email_intro: null,
    updated_at: null,
  },
  meta_lead_reminder_email: {
    key: "meta_lead_reminder_email",
    label: "Meta Lead — Reminder (Email)",
    sms_text: null,
    email_subject: "Dein Glev-Test wartet noch auf dich 🔔",
    email_intro:
      "du hattest Interesse an Glev – der App die dir hilft, deine Insulindosierung besser einzuschätzen. Dein kostenloser 7-Tage-Test ist noch nicht aktiviert.",
    updated_at: null,
  },
};

/** Returns all known template keys with DB values overlaid on defaults. */
export async function getAllTemplates(): Promise<Record<string, MessageTemplate>> {
  // Start from defaults
  const result: Record<string, MessageTemplate> = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    result[k] = { ...v };
  }

  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from("message_templates").select("*").order("key");
    for (const row of data ?? []) {
      const key = row.key as string;
      const def = DEFAULTS[key] ?? {
        key,
        label: key,
        sms_text: null,
        email_subject: null,
        email_intro: null,
        updated_at: null,
      };
      result[key] = {
        key,
        label: (row.label as string) || def.label,
        sms_text: (row.sms_text as string | null) ?? def.sms_text,
        email_subject: (row.email_subject as string | null) ?? def.email_subject,
        email_intro: (row.email_intro as string | null) ?? def.email_intro,
        updated_at: (row.updated_at as string | null) ?? null,
      };
    }
  } catch {
    // return defaults only
  }

  return result;
}

/** Fetches a single template from DB, falling back to hardcoded defaults. */
export async function getTemplate(key: string): Promise<MessageTemplate> {
  const def: MessageTemplate = DEFAULTS[key] ?? {
    key,
    label: key,
    sms_text: null,
    email_subject: null,
    email_intro: null,
    updated_at: null,
  };

  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("message_templates")
      .select("sms_text, email_subject, email_intro, updated_at")
      .eq("key", key)
      .single();
    if (data) {
      return {
        ...def,
        sms_text: (data.sms_text as string | null) ?? def.sms_text,
        email_subject: (data.email_subject as string | null) ?? def.email_subject,
        email_intro: (data.email_intro as string | null) ?? def.email_intro,
        updated_at: (data.updated_at as string | null) ?? null,
      };
    }
  } catch {
    // fallthrough
  }

  return def;
}

/** Renders SMS text replacing {{name}} and {{link}} placeholders. */
export function renderSms(
  template: string,
  vars: { name?: string | null; link: string },
): string {
  return template
    .replace(/\{\{name\}\}/g, vars.name?.trim() ?? "")
    .replace(/\{\{link\}\}/g, vars.link)
    .trim();
}

/** Upserts a template in the DB. */
export async function upsertTemplate(
  key: string,
  updates: {
    sms_text?: string | null;
    email_subject?: string | null;
    email_intro?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = getSupabaseAdmin();
    const def = DEFAULTS[key];
    const { error } = await sb.from("message_templates").upsert(
      {
        key,
        label: def?.label ?? key,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
