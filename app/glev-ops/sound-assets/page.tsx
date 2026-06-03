import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import SoundAssetsClient, { type AssetDef } from "./_components/SoundAssetsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Known sound assets — single source of truth.
// Each entry gets a status check against Supabase Storage at render time.
// ---------------------------------------------------------------------------
const KNOWN_ASSETS: Omit<AssetDef, "url">[] = [
  {
    name: "glev_low_alarm.wav",
    purpose:
      "Hypo-Alarm: spielt auf Android ab, wenn eine Low-Glukose-Push-Benachrichtigung über den Kanal hypo_alarm zugestellt wird (iOS: APNs spielt die Datei ab, wenn sie im App Bundle vorhanden ist). Doppelter Beep 880 Hz + 1046 Hz alternierend, ~3 Sek., −3 dBFS.",
    urgency: "high",
  },
  {
    name: "glev_pre_check.wav",
    purpose:
      "Pre-Bolus-Meal-Timeline-Erinnerung: kurzer sanfter Ton, der an den Check vor dem Bolus erinnert. Niedrige Dringlichkeit.",
    urgency: "low",
  },
  {
    name: "glev_post_check.wav",
    purpose:
      "Post-Bolus-Meal-Timeline-Check: kurzer sanfter Ton, der nach dem Bolus an den Glukose-Kontrollcheck erinnert. Niedrige Dringlichkeit.",
    urgency: "low",
  },
];

const BUCKET = "sound-assets";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SoundAssetsPage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers");

  // Fetch existing files in bucket
  let uploadedNames = new Set<string>();
  let urls = new Map<string, string>();
  try {
    const supabase = getSupabaseAdmin();
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 200 });

    if (files) {
      for (const f of files) {
        if (!f.name) continue;
        uploadedNames.add(f.name);
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(f.name);
        urls.set(f.name, urlData.publicUrl);
      }
    }
  } catch {
    // Bucket may not exist yet — page still renders with all assets as "missing"
  }

  const assets: AssetDef[] = KNOWN_ASSETS.map((a) => ({
    ...a,
    url: uploadedNames.has(a.name) ? (urls.get(a.name) ?? null) : null,
  }));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e2e2ef",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "32px 24px 64px",
      }}
    >
      <SoundAssetsClient initialAssets={assets} />
    </div>
  );
}
