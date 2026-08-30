import { NextResponse } from "next/server";
import { hasPublicSupabaseConfig, hasServerSupabaseConfig } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { adConnectionStatus } from "@/lib/server/ad-performance";
import { youtubeOAuthConfigured } from "@/lib/server/youtube-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ready" | "missing" | "error" = hasServerSupabaseConfig() ? "error" : "missing";
  if (hasServerSupabaseConfig()) {
    const { error } = await createServiceSupabase().from("os_documents").select("id").limit(1);
    database = error ? "error" : "ready";
  }
  const auth = hasPublicSupabaseConfig() ? "ready" : "missing";
  const embeddings = process.env.OPENAI_API_KEY ? "ready" : "keyword_only";
  const telegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET ? "ready" : "missing";
  const contentAi = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY ? "ready" : "missing";
  const youtube = process.env.YOUTUBE_API_KEY ? "ready" : "missing";
  const youtubeOAuth = youtubeOAuthConfigured() ? "ready" : "missing";
  const adConnections = adConnectionStatus();
  const advertising = adConnections.meta.configured && adConnections.google.configured
    ? "ready"
    : adConnections.meta.configured || adConnections.google.configured ? "partial" : "missing";
  return NextResponse.json({
    ok: database === "ready" && auth === "ready",
    service: "brandyaction-os",
    database,
    auth,
    embeddings,
    telegram,
    contentAi,
    youtube,
    youtubeOAuth,
    advertising,
    checkedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
