import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseJson } from "@/lib/http";
import { canUseContentTopicJevAssist } from "@/lib/content-topic-jev-assist-gate";
import { authenticateRequest } from "@/lib/server/auth";
import { evaluateContentTopicJev } from "@/lib/server/content-topic-jev-assist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const inputSchema = z.object({
  topicId: z.string().uuid(), topicVersion: z.number().int().positive().max(2_147_483_647),
  planId: z.string().uuid().optional(), planVersion: z.number().int().positive().max(2_147_483_647).optional(),
}).strict().refine((input) => Boolean(input.planId) === Boolean(input.planVersion), "planId and planVersion must be provided together");
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code, error: { code, message: code } }, { status, headers });
const topicSchema = z.object({
  id: z.string().uuid(), record_type: z.literal("content_topic"), title: z.string().trim().min(1).max(300),
  description: z.string().max(120_000), source_url: z.string().max(2_000).nullable(), metadata: z.record(z.unknown()),
  version: z.number().int().positive(), archived_at: z.null(),
}).passthrough();
const planSchema = z.object({
  id: z.string().uuid(), record_type: z.literal("content_package"), parent_id: z.string().uuid(),
  metadata: z.record(z.unknown()), version: z.number().int().positive(), archived_at: z.null(),
}).passthrough();
const text = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";
function topicMaterial(topic: z.infer<typeof topicSchema>, plan: z.infer<typeof planSchema> | null) {
  const metadata = topic.metadata;
  const briefValue = metadata.researchBrief;
  const brief = briefValue && typeof briefValue === "object" && !Array.isArray(briefValue) ? briefValue as Record<string, unknown> : {};
  const resultValue = plan?.metadata.result;
  const result = resultValue && typeof resultValue === "object" && !Array.isArray(resultValue) ? resultValue as Record<string, unknown> : {};
  return {
    topic: topic.title,
    description: topic.description,
    audience: text(metadata.audience ?? metadata.targetAudience, 1_000),
    entryLanguage: text(metadata.entryLanguage, 1_000),
    hierarchy: text(metadata.hierarchy, 100),
    evidence: text(metadata.evidence, 4_000),
    sourceUrl: topic.source_url ?? "",
    researchSources: Array.isArray(brief.sourceUrls) ? brief.sourceUrls.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 500)).slice(0, 8).join("\n").slice(0, 4_000) : "",
    analystNotes: text(brief.analystNotes, 4_000),
    planningSummary: text(result.summary, 4_000),
    handoff: text(result.handoff, 4_000),
  };
}

export async function POST(request: Request) {
  if (!canUseContentTopicJevAssist(process.env)) return stopped("not_enabled", 404);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return stopped("authentication_failed", 401);
  let input: z.infer<typeof inputSchema>;
  try {
    const parsed = inputSchema.safeParse(await parseJson(request, 1_000));
    if (!parsed.success) return stopped("invalid_input", 400);
    input = parsed.data;
  } catch { return stopped("invalid_input", 400); }

  try {
    const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
    if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword) return stopped("authentication_failed", 401);
    const { data: topicData, error: topicError } = await actor.supabase.from("os_records")
      .select("id,record_type,title,description,source_url,metadata,version,archived_at")
      .eq("id", input.topicId).eq("record_type", "content_topic").is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (topicError) return stopped("read_failed", 503);
    const topicParsed = topicSchema.safeParse(topicData);
    if (!topicParsed.success) return stopped("unavailable", 404);
    const topic = topicParsed.data;
    if (topic.version !== input.topicVersion) return stopped("stale", 409);

    let plan: z.infer<typeof planSchema> | null = null;
    if (input.planId && input.planVersion) {
      const { data, error } = await actor.supabase.from("os_records").select("id,record_type,parent_id,metadata,version,archived_at")
        .eq("id", input.planId).eq("record_type", "content_package").eq("parent_id", topic.id)
        .eq("metadata->>packageKind", "topic_plan").is("archived_at", null)
        .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
      if (error) return stopped("read_failed", 503);
      const parsed = planSchema.safeParse(data);
      if (!parsed.success) return stopped("planning_record_required", 409);
      plan = parsed.data;
      if (plan.version !== input.planVersion) return stopped("stale", 409);
    }

    const shadowEvaluation = await evaluateContentTopicJev(topicMaterial(topic, plan), {
      apiKey: process.env.TYPESAFE_API_KEY ?? "", model: process.env.TYPESAFE_JEV_MODEL,
      signal: AbortSignal.timeout(12_000),
    });

    const [{ data: latestTopic, error: latestTopicError }, latestPlan] = await Promise.all([
      actor.supabase.from("os_records").select("id,version,archived_at").eq("id", topic.id).is("archived_at", null).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
      plan ? actor.supabase.from("os_records").select("id,version,archived_at").eq("id", plan.id).is("archived_at", null).abortSignal(AbortSignal.timeout(10_000)).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (latestTopicError || latestPlan.error) return stopped("read_failed", 503);
    if (!latestTopic || latestTopic.version !== topic.version || plan && (!latestPlan.data || latestPlan.data.version !== plan.version)) return stopped("stale", 409);
    return NextResponse.json({ status: "ready", source: { id: topic.id, version: topic.version }, shadowEvaluation }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return stopped("authentication_failed", 401);
      if (error.status === 403) return stopped("access_denied", 403);
      return stopped(error.status === 409 ? "stale" : "request_failed", error.status);
    }
    const message = error instanceof Error ? error.message : "";
    const name = error instanceof Error ? error.name : "";
    if (message === "TOPIC_JEV_NOT_CONFIGURED") return stopped("provider_not_configured", 503);
    if (message === "TOPIC_JEV_INVALID_RESPONSE") return stopped("provider_response_invalid", 503);
    if (message === "TOPIC_JEV_RESPONSE_TOO_LARGE") return stopped("provider_response_too_large", 503);
    if (message === "TOPIC_JEV_PROVIDER_HTTP_401" || message === "TOPIC_JEV_PROVIDER_HTTP_403") return stopped("provider_auth_failed", 503);
    if (message === "TOPIC_JEV_PROVIDER_HTTP_429") return stopped("provider_rate_limited", 503);
    if (/^TOPIC_JEV_PROVIDER_HTTP_4\d\d$/.test(message)) return stopped("provider_request_rejected", 503);
    if (/^TOPIC_JEV_PROVIDER_HTTP_5\d\d$/.test(message)) return stopped("provider_unavailable", 503);
    if (name === "TimeoutError" || name === "AbortError") return stopped("provider_timeout", 503);
    return stopped("read_failed", 503);
  }
}
