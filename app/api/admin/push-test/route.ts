export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

// Read the admin session cookie directly from the request (avoids next/headers
// cookies() which can throw before the mega try/catch runs in some Next.js 15
// edge cases, causing Next.js to return an HTML error page instead of JSON).
function isAdminAuthedFromRequest(req: NextRequest): boolean {
  const secret = process.env.ADMIN_API_SECRET ?? "";
  if (!secret || secret.length < 16) return false;
  const tok = req.cookies.get("glev_ops_token")?.value ?? "";
  if (!tok) return false;
  const expected = crypto.createHmac("sha256", secret).update("glev-ops-session-v2").digest("hex");
  const aBuf = Buffer.from(tok);
  const bBuf = Buffer.from(expected);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

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

// Uses WebCrypto (crypto.subtle) instead of legacy crypto.createSign() +
// dsaEncoding:"ieee-p1363" which triggers an OpenSSL abort on Vercel Lambda
// even with a valid EC KeyObject. WebCrypto uses a separate code path and
// natively outputs IEEE P1363 format for ECDSA — no dsaEncoding option needed.
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
  title: string,
  body: string,
  sandbox: boolean,
): Promise<{ status: number; responseBody: string }> {
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "default", badge: 1 },
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
  const responseBody = await res.text();
  return { status: res.status, responseBody };
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

// GET — key diagnostics only, no APNs call. Used to pinpoint crash location.
// Requires admin session cookie (same as POST).
export async function GET(req: NextRequest) {
  const keyP8    = process.env.APNS_KEY_P8    ?? "";
  const keyId    = process.env.APNS_KEY_ID    ?? "";
  const teamId   = process.env.APNS_TEAM_ID   ?? "";
  const bundleId = process.env.APNS_BUNDLE_ID ?? "";

  try {
    const sessionOk = isAdminAuthedFromRequest(req);
    const bearerAuth = req.headers.get("authorization") ?? "";
    const bearerSecret = bearerAuth.startsWith("Bearer ") ? bearerAuth.slice(7) : "";
    const bearerOk = Boolean(process.env.ADMIN_API_SECRET) && bearerSecret === process.env.ADMIN_API_SECRET;
    if (!sessionOk && !bearerOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const kd = diagnoseKey(keyP8);
    const envPresent = {
      APNS_KEY_P8:    keyP8.length > 0,
      APNS_KEY_ID:    keyId.length > 0,
      APNS_TEAM_ID:   teamId.length > 0,
      APNS_BUNDLE_ID: bundleId.length > 0,
    };

    // Try key validation without any APNs call
    let keyType: string | null = null;
    let keyError: string | null = null;
    if (keyP8) {
      try {
        const pk = crypto.createPrivateKey({ key: normalizeP8Key(keyP8), format: "pem", type: "pkcs8" });
        keyType = pk.asymmetricKeyType ?? "unknown";
      } catch (e) {
        keyError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }

    return NextResponse.json({ ok: true, envPresent, keyDiag: kd, keyType, keyError });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack: err instanceof Error ? err.stack : "",
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Read env vars up front so they appear in diagnostics even if we crash early.
  const keyP8    = process.env.APNS_KEY_P8    ?? "";
  const keyId    = process.env.APNS_KEY_ID    ?? "";
  const teamId   = process.env.APNS_TEAM_ID   ?? "";
  const bundleId = process.env.APNS_BUNDLE_ID ?? "";

  try {
  // Auth: check glev_ops_token session cookie directly from req.cookies
  // (avoids next/headers which can cause HTML error responses in some Next.js 15 builds).
  // Bearer-token fallback kept for direct API calls / CI scripts.
  const sessionOk = isAdminAuthedFromRequest(req);
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
    // GoTrueAdminApi.listUsers() is the only reliable way to look up a user
    // by email — schema("auth").from("users") is blocked by PostgREST ACL in
    // some Supabase project configs even with service-role key.
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) {
      return NextResponse.json({ error: `Auth-Lookup-Fehler: ${listErr.message}` }, { status: 500 });
    }
    const found = listData.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!found) {
      return NextResponse.json({ error: `Kein User mit E-Mail ${email} gefunden.` }, { status: 404 });
    }
    resolvedUserId = found.id;
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

      // Step 1: Pre-validate key — crypto.createPrivateKey throws synchronously
      // (catchable) whereas crypto.createSign().sign() can kill the Node worker
      // via an OpenSSL abort if the key is malformed.
      let privKey: crypto.KeyObject;
      try {
        privKey = crypto.createPrivateKey({ key: normalizeP8Key(keyP8), format: "pem", type: "pkcs8" });
        console.log("[glev] admin push-test p8 key valid, type=" + privKey.asymmetricKeyType);
      } catch (keyErr) {
        const errInfo = {
          error:   `Key-Validierung fehlgeschlagen: ${keyErr instanceof Error ? `${keyErr.name}: ${keyErr.message}` : String(keyErr)}`,
          stack:   keyErr instanceof Error ? (keyErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] admin push-test key-validate fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Key must be EC (P-256) for APNs ES256 signing.
      // RSA or other key types cause an OpenSSL abort in sign() — not a catchable JS error.
      if (privKey.asymmetricKeyType !== "ec") {
        const errInfo = {
          error:   `Falscher Key-Typ: ${privKey.asymmetricKeyType ?? "unbekannt"} — APNs braucht einen EC (P-256) Key. Bitte APNS_KEY_P8 in Vercel prüfen.`,
          keyDiag: kd,
        };
        console.error("[glev] admin push-test wrong key type:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Step 2: JWT — WebCrypto async signing, no OpenSSL abort risk
      let jwt: string;
      try {
        jwt = await generateAPNsJWT(privKey, keyId, teamId);
        console.log("[glev] admin push-test jwt generated, len=" + jwt.length);
      } catch (jwtErr) {
        const errInfo = {
          error:   `JWT-Fehler: ${jwtErr instanceof Error ? `${jwtErr.name}: ${jwtErr.message}` : String(jwtErr)}`,
          stack:   jwtErr instanceof Error ? (jwtErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] admin push-test jwt fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 500 });
      }

      // Step 3: APNs call with hard 10s timeout
      try {
        const { status, responseBody } = await Promise.race([
          sendAPNs(token, jwt, bundleId, title, body, sandbox as boolean),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("APNs timeout nach 10s")), 10000),
          ),
        ]);
        console.log("[glev] admin push-test APNs response:", status, responseBody.slice(0, 200));
        if (status === 200) return NextResponse.json({ ok: true, platform: "ios", sandbox });
        return NextResponse.json({ error: `APNs returned ${status}`, detail: responseBody }, { status: 502 });
      } catch (apnsErr) {
        const errInfo = {
          error:   `APNs-Fehler: ${apnsErr instanceof Error ? `${apnsErr.name}: ${apnsErr.message}` : String(apnsErr)}`,
          stack:   apnsErr instanceof Error ? (apnsErr.stack ?? "") : "",
          keyDiag: kd,
        };
        console.error("[glev] admin push-test APNs fail:", JSON.stringify(errInfo));
        return NextResponse.json(errInfo, { status: 502 });
      }
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
