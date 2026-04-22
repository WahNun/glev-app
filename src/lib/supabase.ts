import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function makeCookieStorage() {
  return {
    getItem: (k: string) => {
      if (typeof document === "undefined") return null;
      const match = document.cookie.match(new RegExp(`(^|;\\s*)${encodeURIComponent(k)}=([^;]*)`));
      return match ? decodeURIComponent(match[2]) : null;
    },
    setItem: (k: string, v: string) => {
      if (typeof document === "undefined") return;
      document.cookie = `${encodeURIComponent(k)}=${encodeURIComponent(v)};path=/;max-age=604800;SameSite=Lax`;
    },
    removeItem: (k: string) => {
      if (typeof document === "undefined") return;
      document.cookie = `${encodeURIComponent(k)}=;path=/;max-age=0`;
    },
  };
}

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, storage: makeCookieStorage() } })
  : null;
