import type { JSX } from "react";

interface Props {
  action: (formData: FormData) => Promise<void>;
  title?: string;
  description?: string;
  error?: string | null;
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
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

const dividerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#aaa",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginTop: 4,
};

export default function AdminLoginForm({ action, title = "Glev — Admin", description, error }: Props): JSX.Element {
  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 480,
        margin: "60px auto",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{title}</h1>
      {description && (
        <p style={{ marginBottom: 20, color: "#555", fontSize: 14 }}>{description}</p>
      )}
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          placeholder="E-Mail"
          style={inputStyle}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="Passwort"
          style={inputStyle}
        />
        <p style={dividerStyle}>2-Faktor</p>
        <input
          type="text"
          name="totp"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="6-stelliger Authenticator-Code"
          style={inputStyle}
        />
        <button type="submit" style={{ ...btnStyle, marginTop: 4 }}>
          Einloggen
        </button>
        {error && (
          <span style={{ color: "#c00", fontSize: 13 }}>{error}</span>
        )}
      </form>
    </main>
  );
}
