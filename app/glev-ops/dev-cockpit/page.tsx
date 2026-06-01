import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import DevCockpit from "./DevCockpit";
import { TASK_COLUMNS, ACTIVE_STATUSES, type DevTask } from "./types";

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

  // Server-side initial load of the default ("Active") sidebar view so the
  // first paint already shows real persisted tasks. The client component
  // re-fetches via server actions when the filter changes or data mutates.
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false });

  const initialTasks = (data ?? []) as DevTask[];

  return <DevCockpit initialTasks={initialTasks} />;
}
