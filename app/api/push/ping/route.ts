export const runtime = "nodejs";

export async function GET() {
  return Response.json({ alive: true, runtime: "nodejs", ts: Date.now() });
}
