import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL } from "../config";

export function createUserSupabase(accessToken: string) {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error("SUPABASE_PUBLIC_CONFIG_MISSING");
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_CONFIG_MISSING");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createCredentialSupabase() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    throw new Error("SUPABASE_PUBLIC_CONFIG_MISSING");
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
