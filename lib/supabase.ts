import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const CHUNK_SIZE = 3000;
const MAX_CHUNKS = 16;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const flags = secure ? "SameSite=None;Secure" : "SameSite=Lax";
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=604800;${flags}`;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  const flags = secure ? "SameSite=None;Secure" : "SameSite=Lax";
  document.cookie = `${name}=;path=/;max-age=0;${flags}`;
}

function makeCookieStorage() {
  return {
    getItem: (k: string) => {
      const single = readCookie(k);
      if (single !== null) return single;
      const parts: string[] = [];
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const piece = readCookie(`${k}.${i}`);
        if (piece === null) break;
        parts.push(piece);
      }
      return parts.length ? parts.join("") : null;
    },
    setItem: (k: string, v: string) => {
      deleteCookie(k);
      for (let i = 0; i < MAX_CHUNKS; i++) deleteCookie(`${k}.${i}`);
      if (v.length <= CHUNK_SIZE) {
        writeCookie(k, v);
        return;
      }
      let i = 0;
      for (let off = 0; off < v.length; off += CHUNK_SIZE) {
        writeCookie(`${k}.${i}`, v.slice(off, off + CHUNK_SIZE));
        i++;
        if (i >= MAX_CHUNKS) break;
      }
    },
    removeItem: (k: string) => {
      deleteCookie(k);
      for (let i = 0; i < MAX_CHUNKS; i++) deleteCookie(`${k}.${i}`);
    },
  };
}

const g = globalThis as typeof globalThis & { _supabase?: SupabaseClient | null };

if (!g._supabase) {
  g._supabase = url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: makeCookieStorage(),
        },
      })
    : null;
}

export const supabase = g._supabase ?? null;
