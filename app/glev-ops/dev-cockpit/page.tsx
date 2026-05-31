import { isAdminAuthed } from "@/lib/adminAuth";
import DevCockpit from "./DevCockpit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DevCockpitPage() {
  const authed = await isAdminAuthed();

  if (!authed) {
    return (
      <main
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: 24,
          color: "#555",
          fontSize: 14,
        }}
      >
        Nicht authentifiziert. Bitte zuerst einloggen.
      </main>
    );
  }

  return <DevCockpit />;
}
