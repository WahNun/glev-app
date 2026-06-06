"use client";

import { useState } from "react";

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  flex: 1,
  minWidth: 0,
  boxSizing: "border-box",
};

const toggleStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#f5f5f5",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export default function PasswordInput() {
  const [show, setShow] = useState(false);

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type={show ? "text" : "password"}
        name="password"
        required
        minLength={8}
        autoComplete="off"
        style={inputStyle}
      />
      <button type="button" onClick={() => setShow((s) => !s)} style={toggleStyle}>
        {show ? "Verbergen" : "Anzeigen"}
      </button>
    </div>
  );
}
