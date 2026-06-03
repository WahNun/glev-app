import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import http2 from "http2";
import crypto from "crypto";

function normalizeP8Key(raw: string): string {
  let key = raw.replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\n/g, "\n");
  if (!key.includes("\n")) {
    const begin = "-----BEGIN PRIVATE KEY-----";
    const end   = "-----END PRIVATE KEY-----";
    const body  = key.replace(begin, "").replace(end, "").replace(/\s/g, "");
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    key = `${begin}\n${wrapped}\n${end}\n`;
  }
  return key;
}

function generateAPNsJWT(keyP8: string, keyId: string, teamId: string): string {
  const key = normalizeP8Key(keyP8);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const sig = sign.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${signingInput}.${sig}`;
}

function sendAPNs(
  token: string,
  jwt: string,
  bundleId: string,
  sandbox: boolean,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const client = http2.connect(`https://${host}`);
    client.on("error", reject);

    const payload = JSON.stringify({
      aps: { alert: { title: "🔔 Glev Test-Push", body: "Push-Benachrichtigungen funktionieren!" }, sound: "default", badge: 1 },
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload).toString(),
    });
    req.write(payload);
    req.end();

    let status = 0;
    let body = "";
    req.on("response", (h) => { status = h[":status"] as number; });
    req.on("data", (c) => { body += c; });
    req.on("end", () => { client.close(); resolve({ status, body }); });
    req.on("error", (e) => { client.close(); reject(e); });
  });
}

async function sendFCM(token: string, serverKey: string): Promise<{ status: number; body: string }> {
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: { "Authorization": `key=${serverKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: token,
      notification: { title: "🔔 Glev Test-Push", body: "Push-Benachrichtigungen funktionieren!", sound: "default" },
      priority: "high",
    }),
  });
  return { status: res.status, body: await res.text() };
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });

  const { sandbox = false } = await req.json() as { sandbox?: boolean };

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("push_token, push_platform")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.push_token) {
    return NextResponse.json(
      { error: "Kein Push-Token in der DB. Bitte erst die Push-Registrierung neu starten." },
      { status: 404 },
    );
  }

  const { push_token: token, push_platform: platform } = profile;

  try {
    if (platform === "ios") {
      const keyP8 = process.env.APNS_KEY_P8;
      const keyId = process.env.APNS_KEY_ID;
      const teamId = process.env.APNS_TEAM_ID;
      const bundleId = process.env.APNS_BUNDLE_ID;
      if (!keyP8 || !keyId || !teamId || !bundleId) {
        return NextResponse.json({ error: "APNS-Env-Variablen fehlen in Vercel." }, { status: 500 });
      }
      const jwt = generateAPNsJWT(keyP8, keyId, teamId);
      const { status, body } = await sendAPNs(token, jwt, bundleId, sandbox);
      if (status === 200) return NextResponse.json({ ok: true, platform: "ios", sandbox });
      return NextResponse.json({ error: `APNs ${status}`, detail: body }, { status: 502 });
    }

    if (platform === "android") {
      const serverKey = process.env.FIREBASE_SERVER_KEY;
      if (!serverKey) return NextResponse.json({ error: "FIREBASE_SERVER_KEY fehlt." }, { status: 500 });
      const { status, body } = await sendFCM(token, serverKey);
      if (status === 200) return NextResponse.json({ ok: true, platform: "android" });
      return NextResponse.json({ error: `FCM ${status}`, detail: body }, { status: 502 });
    }

    return NextResponse.json({ error: `Unbekannte Plattform: ${platform}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
