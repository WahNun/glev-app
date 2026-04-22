import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasOpenAIBaseUrl: !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    hasOpenAIKey: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    runtime: "server",
  });
}
