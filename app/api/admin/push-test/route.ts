import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import http2 from "http2";
import crypto from "crypto";

function normalizeP8Key(raw: string): string {
  let key = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();

  if (!key.includes("\n")) {
    const begin = "-----BEGIN PRIVATE KEY-----";
    const end   = "-----END PRIVATE KEY-----";
    const body  = key.replace(begin, "").replace(end, "").replace(/\s/g, "");
    const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
    key = `${begin}\n${wrapped}\n${end}`;
  }

  if (!key.endsWith("\n")) key += "\n";
  return key;
}

function diagnoseKey(raw: string): Record<string, unknown> {
  return {
    length:          raw.length,
    hasBegin:        raw.includes("-----BEGIN PRIVATE KEY-----"),
    hasEnd:          raw.includes("-----END PRIVATE KEY-----"),
    realNewlines:    raw.includes("\n"),
    escapedNewlines: raw.includes("\\n"),
    lineCount:       raw.split("\n").length,
    firstChars:      raw.slice(0, 30).replace(/\n/g, "↵"),
  };
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
  // Read env vars up front so they appear in diagnostics even if we crash early.
  const keyP8    = process.env.APNS_KEY_P8    ?? "";
  const keyId    = process.env.APNS_KEY_ID    ?? "";
  const teamId   = process.env.APNS_TEAM_ID   ?? "";
  const bundleId = process.env.APNS_BUNDLE_ID ?? "";

  try {
  // Auth via server-side session cookie (httpOnly — JS cannot read it).
  // Bearer-token fallback kept for direct API calls / CI scripts.
  const sessionOk = await isAdminAuthed();
  const bearerAuth = req.headers.get("authorization") ?? "";
  const bearerSecret = bearerAuth.startsWith("Bearer ") ? bearerAuth.slice(7) : "";
  const bearerOk = Boolean(process.env.ADMIN_API_SECRET) && bearerSecret === process.env.ADMIN_API_SECRET;
  if (!sessionOk && !bearerOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, email, sandbox = false } = await req.json() as { userId?: string; email?: string; sandbox?: boolean };

  const admin = getSupabaseAdmin();

  let resolvedUserId = userId;
  if (!resolvedUserId && email) {
    // Supabase GoTrueAdminApi has no getUserByEmail — query auth.users directly
    // via service-role (bypasses RLS on all schemas including auth).
    const { data: authRow, error: lookupErr } = await admin
      .schema("auth")
      .from("users")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (lookupErr || !authRow?.id) {
      return NextResponse.json({ error: `Kein User mit E-Mail ${email} gefunden.` }, { status: 404 });
    }
    resolvedUserId = authRow.id as string;
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

    if (platform === "ios") {
      if (!keyP8 || !keyId || !teamId || !bundleId) {
        const missing = [
          !keyP8    && "APNS_KEY_P8",
          !keyId    && "APNS_KEY_ID",
          !teamId   && "APNS_TEAM_ID",
          !bundleId && "APNS_BUNDLE_ID",
        ].filter(Boolean).join(", ");
        return NextResponse.json({ error: `APNS-Env-Variablen fehlen: ${missing}` }, { status: 500 });
      }

      const kd = diagnoseKey(keyP8);
      let jwt: string;
      try {
        jwt = generateAPNsJWT(keyP8, keyId, teamId);
      } catch (jwtErr) {
        const errInfo = {
          error:   `JWT-Fehler: ${jwtErr instanceof Error ? `${jwtErr.name}: ${jwtErr.message}` : String(jwtErr)}`,
          stack:   jwtErr instanceof Error ? (jwtErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] /api/admin/push-test JWT crash:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      const { status, responseBody } = await sendAPNs(token, jwt, bundleId, title, body, sandbox as boolean);
      if (status === 200) return NextResponse.json({ ok: true, platform: "ios", sandbox });
      return NextResponse.json({ error: `APNs returned ${status}`, detail: responseBody }, { status: 502 });
    }

    if (platform === "android") {
      const serverKey = process.env.FIREBASE_SERVER_KEY;
      if (!serverKey) return NextResponse.json({ error: "FIREBASE_SERVER_KEY fehlt." }, { status: 500 });
      const { status, responseBody } = await sendFCM(token, title, body, serverKey);
      if (status === 200) return NextResponse.json({ ok: true, platform: "android" });
      return NextResponse.json({ error: `FCM returned ${status}`, detail: responseBody }, { status: 502 });
    }

    return NextResponse.json({ error: `Unbekannte Plattform: ${platform}` }, { status: 400 });

  } catch (err) {
    const errInfo = {
      error:   err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack:   err instanceof Error ? (err.stack ?? "") : "",
      keyDiag: diagnoseKey(keyP8),
    };
    console.error("[glev] /api/admin/push-test unhandled crash:", JSON.stringify(errInfo));
    return NextResponse.json(errInfo, { status: 500 });
  }
}
