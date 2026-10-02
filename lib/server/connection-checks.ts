import { CONNECTIONS, connectionState, type ConnectionCheck, type ConnectionId } from "@/lib/connection-status";
import { hasPublicSupabaseConfig, hasServerSupabaseConfig } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { adConnectionStatus, probeAdConnections } from "@/lib/server/ad-performance";
import type { authenticateRequest } from "@/lib/server/auth";

export function connectionConfiguration(): Record<ConnectionId, boolean> {
  const ads = adConnectionStatus();
  return { database: hasServerSupabaseConfig(), auth: hasPublicSupabaseConfig(), embeddings: Boolean(process.env.OPENAI_API_KEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), contentAi: Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
    youtube: Boolean(process.env.YOUTUBE_API_KEY), advertising: ads.meta.configured || ads.google.configured, orders: false };
}

export async function readConnectionChecks() {
  const db = createServiceSupabase();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const configured = connectionConfiguration();
  const owners = await db.from("os_connection_owners").select("service,primary_owner,backup_owner,version");
  return Promise.all(CONNECTIONS.map(async ({ id }): Promise<ConnectionCheck> => {
    const [lastOk, latest, failures] = await Promise.all([
      db.from("os_connection_checks").select("checked_at").eq("service", id).eq("ok", true).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("os_connection_checks").select("checked_at,ok").eq("service", id).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("os_connection_checks").select("id", { count: "exact", head: true }).eq("service", id).eq("ok", false).gte("checked_at", since),
    ]);
    let lastOkAt = lastOk.data?.checked_at ?? null;
    let failures24h: number | null = failures.error || !latest.data ? null : failures.count;
    let blockedJobs: number | null = null;
    let evidenceAvailable = !lastOk.error && !latest.error && !failures.error;
    // Existing failed jobs take precedence over a successful credentials probe.
    if (id === "embeddings") {
      const [failed, success] = await Promise.all([
        db.from("os_embedding_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
        db.from("os_embedding_jobs").select("finished_at").eq("status", "done").is("last_error", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      blockedJobs = failed.error ? null : failed.count;
      if (success.data?.finished_at && (!lastOkAt || success.data.finished_at > lastOkAt)) lastOkAt = success.data.finished_at;
      evidenceAvailable &&= !failed.error && !success.error;
    }
    if (id === "advertising") {
      const [failed, success] = await Promise.all([
        db.from("os_ad_sync_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("finished_at", since),
        db.from("os_ad_sync_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      failures24h = failed.error || failures24h === null ? null : failures24h + (failed.count ?? 0);
      if (success.data?.finished_at && (!lastOkAt || success.data.finished_at > lastOkAt)) lastOkAt = success.data.finished_at;
      evidenceAvailable &&= !failed.error && !success.error;
    }
    const owner = owners.data?.find(row => row.service === id);
    const check = { id, configured: configured[id], lastOkAt, lastCheckedAt: latest.data?.checked_at ?? null, failures24h, blockedJobs,
      latestFailed: latest.data?.ok === false, historyAvailable: evidenceAvailable, primaryOwner: owner?.primary_owner ?? null,
      backupOwner: owner?.backup_owner ?? null, ownerVersion: owner?.version ?? 0 };
    return { ...check, status: connectionState(check) };
  }));
}

async function readOnlyProbe(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error("CONNECTION_PROBE_FAILED");
  // Do not return or log provider bodies; they can contain credentials or account details.
  await response.body?.cancel();
}
export async function probeConnection(id: ConnectionId, actor: Awaited<ReturnType<typeof authenticateRequest>>) {
  switch (id) {
    case "database": { const result = await createServiceSupabase().from("os_documents").select("id").limit(1).abortSignal(AbortSignal.timeout(15_000)); if (result.error) throw new Error("DATABASE_FAILED"); return; }
    case "auth": { if (!actor.id) throw new Error("AUTH_FAILED"); return; }
    case "embeddings": return readOnlyProbe("https://api.openai.com/v1/models", { authorization: `Bearer ${process.env.OPENAI_API_KEY}` });
    case "contentAi": return readOnlyProbe("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "", "anthropic-version": "2023-06-01" });
    case "telegram": return readOnlyProbe(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    case "youtube": return readOnlyProbe(`https://www.googleapis.com/youtube/v3/i18nLanguages?part=id&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY || "")}`);
    case "advertising": return probeAdConnections();
    default: throw new Error("CONNECTION_NOT_IMPLEMENTED");
  }
}
