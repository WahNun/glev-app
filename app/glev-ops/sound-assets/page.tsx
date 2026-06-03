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
      "Hypo-Alarm: 880 Hz + 1046 Hz alternierend, 6× Doppel-Beep, ~3.3 Sek., −3 dBFS. Android: Kanal hypo_alarm. iOS: APNs sound field.",
    urgency: "high",
  },
  {
    name: "glev_high_alarm.wav",
    purpose:
      "Hyper-Alarm: 660 Hz + 784 Hz alternierend, 4× Doppel-Beep, ~2.6 Sek., −3 dBFS. Android: Kanal hyper_alarm. iOS: APNs sound field.",
    urgency: "high",
  },
  {
    name: "glev_elevated.wav",
    purpose:
      "Erhöhter BZ-Alarm: 523 Hz, 3× sanfte Beeps, ~1.2 Sek., −6 dBFS. Android: Kanal elevated_alarm. iOS: APNs sound field.",
    urgency: "medium",
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
