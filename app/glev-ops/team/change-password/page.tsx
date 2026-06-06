import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, getSessionRole } from "@/lib/adminAuth";
import { changeOwnPasswordAction } from "../actions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const role = await getSessionRole();
  if (!role) redirect("/glev-ops/users");

  // Get current user's email for the form (need it to re-verify)
  const store = await cookies();
  const tok   = store.get(ADMIN_COOKIE)?.value ?? "";
  let email   = "";

  if (tok.startsWith("team:")) {
    const userId  = tok.split(":")[1];
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("glev_ops_users")
      .select("email, must_change_pw")
      .eq("id", userId)
      .single();
    email = data?.email ?? "";
    // If must_change_pw is already false, no need to be here
    if (data && !data.must_change_pw) {
      redirect(role === "admin" ? "/glev-ops/users" : "/glev-ops/crm");
    }
  } else {
    // Env-var admin/marketer doesn't need password change
    redirect(role === "admin" ? "/glev-ops/users" : "/glev-ops/crm");
  }

  const sp  = await searchParams;
  const err = sp.err;
  const errMsg: Record<string, string> = {
    short: "Neues Passwort muss mind. 8 Zeichen haben.",
    wrong: "Aktuelles Passwort ist falsch.",
  };

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 400,
        margin: "60px auto",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Passwort setzen</h1>
      <p style={{ color: "#555", fontSize: 14, marginBottom: 24 }}>
        Bitte setze dein persönliches Passwort, bevor du weiter machst.
      </p>

      {err && errMsg[err] && (
        <div
          style={{
            padding: "10px 14px",
            background: "#ffebee",
            color: "#c00",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {errMsg[err]}
        </div>
      )}

      <form
        action={changeOwnPasswordAction}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <input type="hidden" name="email" value={email} />
        <input
          type="password"
          name="current"
          placeholder="Aktuelles Passwort"
          required
          style={inputStyle}
        />
        <input
          type="password"
          name="newPw"
          placeholder="Neues Passwort (mind. 8 Zeichen)"
          required
          minLength={8}
          style={inputStyle}
        />
        <button type="submit" style={{ ...btnStyle, marginTop: 4 }}>
          Passwort setzen & einloggen
        </button>
      </form>
    </main>
  );
}
