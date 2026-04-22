import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { signToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/jwt";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json() as { email?: string; password?: string };
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });

    const existing = await pool.query("SELECT id FROM glev_users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length > 0) return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });

    const passwordHash = await hash(password, 12);
    const result = await pool.query(
      "INSERT INTO glev_users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email.toLowerCase(), passwordHash]
    );
    const user = result.rows[0] as { id: number; email: string };
    const token = await signToken({ userId: user.id, email: user.email });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("[signup]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
