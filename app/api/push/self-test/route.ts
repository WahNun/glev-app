export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
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

// Uses WebCrypto (crypto.subtle) — avoids crypto.createSign() + dsaEncoding:"ieee-p1363"
// which triggers an OpenSSL abort on Vercel Lambda even with a valid EC KeyObject.
// WebCrypto natively outputs IEEE P1363 for ECDSA; no dsaEncoding option needed.
async function generateAPNsJWT(privKey: crypto.KeyObject, keyId: string, teamId: string): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;

  const jwk = privKey.export({ format: "jwk" }) as JsonWebKey;
  const subtleKey = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    subtleKey,
    Buffer.from(signingInput),
  );
  const sig = Buffer.from(sigBuffer).toString("base64url");
  return `${signingInput}.${sig}`;
}

async function sendAPNs(
  token: string,
  jwt: string,
  bundleId: string,
  sandbox: boolean,
): Promise<{ status: number; body: string }> {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const payload = JSON.stringify({
    aps: { alert: { title: "🔔 Glev Test-Push", body: "Push-Benachrichtigungen funktionieren!" }, sound: "default", badge: 1 },
  });
  const res = await fetch(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      "authorization": `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: payload,
  });
  const body = await res.text();
  return { status: res.status, body };
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
  const keyP8    = process.env.APNS_KEY_P8    ?? "";
  const keyId    = process.env.APNS_KEY_ID    ?? "";
  const teamId   = process.env.APNS_TEAM_ID   ?? "";
  const bundleId = process.env.APNS_BUNDLE_ID ?? "";

  try {
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
        { error: "Kein Push-Token in der DB. Push-Registrierung neu starten." },
        { status: 404 },
      );
    }

    const { push_token: token, push_platform: platform } = profile;

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

      // Step 1: Pre-validate key — crypto.createPrivateKey throws synchronously
      // (catchable) whereas crypto.createSign().sign() can kill the Node worker
      // process via an OpenSSL abort if the key is malformed.
      let privKey: crypto.KeyObject;
      try {
        privKey = crypto.createPrivateKey({ key: normalizeP8Key(keyP8), format: "pem", type: "pkcs8" });
        console.log("[glev] self-test p8 key valid, type=" + privKey.asymmetricKeyType);
        // noop — linting guard so privKey is always read before the type check below
        void privKey;
      } catch (keyErr) {
        const errInfo = {
          error:   `Key-Validierung fehlgeschlagen: ${keyErr instanceof Error ? `${keyErr.name}: ${keyErr.message}` : String(keyErr)}`,
          stack:   keyErr instanceof Error ? (keyErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] self-test key-validate fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Key must be EC (P-256) for APNs ES256 signing.
      // RSA or other key types cause an OpenSSL abort in sign() — not a catchable JS error.
      if (privKey.asymmetricKeyType !== "ec") {
        const errInfo = {
          error:   `Falscher Key-Typ: ${privKey.asymmetricKeyType ?? "unbekannt"} — APNs braucht einen EC (P-256) Key. Bitte APNS_KEY_P8 in Vercel prüfen.`,
          keyDiag: kd,
        };
        console.error("[glev] self-test wrong key type:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Step 2: JWT — WebCrypto async signing, no OpenSSL abort risk
      let jwt: string;
      try {
        jwt = await generateAPNsJWT(privKey, keyId, teamId);
        console.log("[glev] self-test jwt generated, len=" + jwt.length);
      } catch (jwtErr) {
        const errInfo = {
          error:   `JWT-Fehler: ${jwtErr instanceof Error ? `${jwtErr.name}: ${jwtErr.message}` : String(jwtErr)}`,
          stack:   jwtErr instanceof Error ? (jwtErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] self-test jwt fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Step 3: APNs call with hard 10s timeout
      try {
        const { status, body } = await Promise.race([
          sendAPNs(token, jwt, bundleId, sandbox),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("APNs timeout nach 10s")), 10000),
          ),
        ]);
        console.log("[glev] self-test APNs response:", status, body.slice(0, 200));
        if (status === 200) return NextResponse.json({ ok: true, platform: "ios", sandbox });
        return NextResponse.json({ error: `APNs ${status}`, detail: body }, { status: 502 });
      } catch (apnsErr) {
        const errInfo = {
          error:   `APNs-Fehler: ${apnsErr instanceof Error ? `${apnsErr.name}: ${apnsErr.message}` : String(apnsErr)}`,
          stack:   apnsErr instanceof Error ? (apnsErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] self-test APNs fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 502 });
      }
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
    const errInfo = {
      error:   err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack:   err instanceof Error ? (err.stack ?? "") : "",
      keyDiag: diagnoseKey(keyP8),
    };
    console.error("[glev] self-test unhandled crash:", JSON.stringify(errInfo));
    return NextResponse.json(errInfo, { status: 500 });
  }
}
