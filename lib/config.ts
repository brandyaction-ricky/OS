export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";

export const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const OS_INITIAL_PASSWORD = process.env.OS_INITIAL_PASSWORD ?? "";

export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

// Model tiers (owner 2026-10-26): routine work runs on the fast models; only work that needs high
// intelligence (YouTube scripts and columns, meeting minutes) uses the smart tier. Env vars override.
export const OPENAI_ANSWER_MODEL = process.env.OPENAI_ANSWER_MODEL || "gpt-6-luna";
export const CLAUDE_FAST_MODEL = process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-5-5";
export const CLAUDE_SMART_MODEL = process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-5-5";

export function hasPublicSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);
}

export function hasServerSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

export function isDemoMode() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !hasPublicSupabaseConfig();
}
