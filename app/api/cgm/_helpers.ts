import { NextResponse } from "next/server";

export function errResponse(e: unknown): NextResponse {
  const err = e as {
    status?: number;
    message?: string;
    code?: string;
    upstream?: boolean;
    response?: { status?: number };
  };
  if (err?.status) {
    return NextResponse.json({ error: err.message || "error" }, { status: err.status });
  }
  if (err?.code === "ECONNABORTED" || err?.code === "ETIMEDOUT") {
    return NextResponse.json({ error: "upstream timeout" }, { status: 504 });
  }
  if (err?.response?.status) {
    const s = err.response.status;
    if (s === 401) return NextResponse.json({ error: "LLU rejected credentials" }, { status: 502 });
    return NextResponse.json({ error: `LLU upstream ${s}` }, { status: 502 });
  }
  if (err?.upstream) {
    return NextResponse.json({ error: err.message || "upstream error" }, { status: 502 });
  }
  // eslint-disable-next-line no-console
  console.error("[cgm] internal:", err?.message || err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
