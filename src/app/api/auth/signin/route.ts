import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { Pool } from "pg";
import { signToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/jwt";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json() as { email?: string; password?: string };
    if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

    const result = await pool.query("SELECT id, email, password_hash FROM glev_users WHERE email = $1", [email.toLowerCase()]);
    if (result.rows.length === 0) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

    const user = result.rows[0] as { id: number; email: string; password_hash: string };
    const valid = await compare(password, user.password_hash);
    if (!valid) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

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
    console.error("[signin]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
