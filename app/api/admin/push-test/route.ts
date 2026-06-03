import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import http2 from "http2";
import crypto from "crypto";

const ADMIN_SECRET = process.env.ADMIN_API_SECRET;

function generateAPNsJWT(keyP8: string, keyId: string, teamId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const sig = sign.sign({ key: keyP8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${signingInput}.${sig}`;
}

function sendAPNs(
  token: string,
  jwt: string,
  bundleId: string,
  title: string,
  body: string,
  sandbox: boolean,
): Promise<{ status: number; responseBody: string }> {
  return new Promise((resolve, reject) => {
    const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const client = http2.connect(`https://${host}`);
    client.on("error", reject);

    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: "default", badge: 1 },
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
    let responseBody = "";

    req.on("response", (headers) => {
      status = headers[":status"] as number;
    });
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      client.close();
      resolve({ status, responseBody });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
  });
}

async function sendFCM(
  token: string,
  title: string,
  body: string,
  serverKey: string,
): Promise<{ status: number; responseBody: string }> {
  const res = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Authorization": `key=${serverKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: token,
      notification: { title, body, sound: "default" },
      priority: "high",
    }),
  });
  const responseBody = await res.text();
  return { status: res.status, responseBody };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, email, sandbox = false } = await req.json() as { userId?: string; email?: string; sandbox?: boolean };

  const admin = getSupabaseAdmin();

  let resolvedUserId = userId;
  if (!resolvedUserId && email) {
    const { data: authUser } = await admin.auth.admin.listUsers();
    const match = authUser?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!match) {
      return NextResponse.json({ error: `Kein User mit E-Mail ${email} gefunden.` }, { status: 404 });
    }
    resolvedUserId = match.id;
  }

  if (!resolvedUserId) {
    return NextResponse.json({ error: "userId oder email erforderlich" }, { status: 400 });
  }

  const { data: profile, error } = await admin
    .from("profiles")
    .select("push_token, push_platform")
    .eq("user_id", resolvedUserId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!profile?.push_token) {
    return NextResponse.json(
      { error: "Kein Push-Token für diesen User. App öffnen → Token registriert sich automatisch." },
      { status: 404 },
    );
  }

  const { push_token: token, push_platform: platform } = profile;
  const title = "🔔 Glev Test-Push";
  const body = "Push-Benachrichtigungen funktionieren!";

  try {
    if (platform === "ios") {
      const keyP8 = process.env.APNS_KEY_P8;
      const keyId = process.env.APNS_KEY_ID;
      const teamId = process.env.APNS_TEAM_ID;
      const bundleId = process.env.APNS_BUNDLE_ID;

      if (!keyP8 || !keyId || !teamId || !bundleId) {
        return NextResponse.json(
          { error: "APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID fehlen in Vercel env vars." },
          { status: 500 },
        );
      }

      const jwt = generateAPNsJWT(keyP8, keyId, teamId);
      const { status, responseBody } = await sendAPNs(token, jwt, bundleId, title, body, sandbox as boolean);

      if (status === 200) {
        return NextResponse.json({ ok: true, platform: "ios", sandbox });
      }
      return NextResponse.json(
        { error: `APNs returned ${status}`, detail: responseBody },
        { status: 502 },
      );
    }

    if (platform === "android") {
      const serverKey = process.env.FIREBASE_SERVER_KEY;
      if (!serverKey) {
        return NextResponse.json(
          { error: "FIREBASE_SERVER_KEY fehlt in Vercel env vars." },
          { status: 500 },
        );
      }
      const { status, responseBody } = await sendFCM(token, title, body, serverKey);
      if (status === 200) {
        return NextResponse.json({ ok: true, platform: "android" });
      }
      return NextResponse.json(
        { error: `FCM returned ${status}`, detail: responseBody },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: `Unbekannte Plattform: ${platform}` },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
