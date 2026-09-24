import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { evaluateJevContentAssist } from "@/lib/server/content-jev-assist";
import { canUseContentJevAssist } from "@/lib/content-jev-assist-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const inputSchema = z.object({
  sourceId: z.string().uuid(), sourceVersion: z.number().int().positive().max(2_147_483_647),
  packageId: z.string().uuid(), packageVersion: z.number().int().positive().max(2_147_483_647),
}).strict();
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code, error: { code, message: code } }, { status, headers });
const topicSchema = z.object({
  id: z.string().uuid(), record_type: z.literal("content_topic"), title: z.string().trim().min(1).max(300),
  description: z.string().max(120_000), brand: z.string().max(100), metadata: z.record(z.unknown()),
  version: z.number().int().positive(), archived_at: z.null(),
}).passthrough();
const packageSchema = z.object({
  id: z.string().uuid(), record_type: z.literal("content_package"), parent_id: z.string().uuid(),
  title: z.string().max(300), metadata: z.record(z.unknown()), version: z.number().int().positive(), archived_at: z.null(),
}).passthrough();
function pickedText(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is Record<string, unknown> => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && candidate.picked === true)
    .map((candidate) => candidate.text).filter((text): text is string => typeof text === "string" && text.trim().length > 0 && text.trim().length <= max).map((text) => text.trim());
}
const text = (value: unknown, limit: number) => typeof value === "string" && value.trim().length <= limit ? value.trim() : "";

export async function POST(request: Request) {
  if (!canUseContentJevAssist(process.env)) return stopped("not_enabled", 404);
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
    // Use the signed-in person's RLS-scoped client: team-visible topics remain
    // available only when the existing OS document/record policy allows them.
    const { data: topicData, error: topicError } = await actor.supabase.from("os_records")
      .select("id,record_type,title,description,brand,metadata,version,archived_at")
      .eq("id", input.sourceId).eq("record_type", "content_topic").is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (topicError) return stopped("read_failed", 503);
    const topicParsed = topicSchema.safeParse(topicData);
    if (!topicParsed.success) return stopped("unavailable", 404);
    const topic = topicParsed.data;
    if (topic.version !== input.sourceVersion) return stopped("stale", 409);

    const { data: packageData, error: packageError } = await actor.supabase.from("os_records")
      .select("id,record_type,parent_id,title,metadata,version,archived_at")
      .eq("id", input.packageId).eq("record_type", "content_package").eq("parent_id", topic.id)
      .eq("metadata->>packageKind", "title_package").is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (packageError) return stopped("read_failed", 503);
    const packageParsed = packageSchema.safeParse(packageData);
    if (!packageParsed.success) return stopped("packaging_selection_required", 409);
    const selectedPackage = packageParsed.data;
    if (selectedPackage.version !== input.packageVersion) return stopped("stale", 409);
    const result = selectedPackage.metadata.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return stopped("packaging_selection_required", 409);
    const candidates = result as Record<string, unknown>;
    const titles = pickedText(candidates.titles, 300);
    const copies = pickedText(candidates.copies, 500);
    if (titles.length !== 1 || copies.length !== 1) return stopped("packaging_selection_required", 409);

    const handoff = topic.metadata.planningHandoff;
    const handoffRecord = handoff && typeof handoff === "object" && !Array.isArray(handoff) ? handoff as Record<string, unknown> : {};
    const material = {
      title: titles[0], thumbnailCopy: copies[0],
      audience: text(topic.metadata.audience, 1_000) || text(topic.metadata.targetAudience, 1_000) || "브랜디액션 유튜브 시청자",
      coreContent: topic.description.trim().slice(0, 4_000) || topic.title,
      evidenceNotes: text(handoffRecord.evidenceNotes, 4_000) || "근거 메모가 입력되지 않았습니다. 사실·전망·해석을 추가 확인하세요.",
      viewerPromise: text(handoffRecord.titlePromise, 1_000) || "제목과 썸네일이 약속하는 답을 영상에서 제공하는지 확인하세요.",
    };
    const shadowEvaluation = await evaluateJevContentAssist(material, {
      apiKey: process.env.TYPESAFE_API_KEY ?? "", model: process.env.TYPESAFE_JEV_MODEL,
      signal: AbortSignal.timeout(12_000),
    });

    const [{ data: latestTopic, error: latestTopicError }, { data: latestPackage, error: latestPackageError }] = await Promise.all([
      actor.supabase.from("os_records").select("id,version,archived_at").eq("id", topic.id).is("archived_at", null).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
      actor.supabase.from("os_records").select("id,version,archived_at").eq("id", selectedPackage.id).is("archived_at", null).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
    ]);
    if (latestTopicError || latestPackageError) return stopped("read_failed", 503);
    if (!latestTopic || latestTopic.version !== topic.version || !latestPackage || latestPackage.version !== selectedPackage.version) return stopped("stale", 409);

    return NextResponse.json({ status: "ready", source: { id: topic.id, version: topic.version }, package: { id: selectedPackage.id, version: selectedPackage.version }, shadowEvaluation }, { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return stopped("authentication_failed", 401);
      if (error.status === 403) return stopped("access_denied", 403);
      return stopped(error.status === 409 ? "stale" : "request_failed", error.status);
    }
    const message = error instanceof Error ? error.message : "";
    const name = error instanceof Error ? error.name : "";
    if (message === "JEV_NOT_CONFIGURED") return stopped("provider_not_configured", 503);
    if (message === "JEV_INVALID_RESPONSE") return stopped("provider_response_invalid", 503);
    if (message === "JEV_RESPONSE_TOO_LARGE") return stopped("provider_response_too_large", 503);
    if (message === "JEV_PROVIDER_HTTP_401" || message === "JEV_PROVIDER_HTTP_403") return stopped("provider_auth_failed", 503);
    if (message === "JEV_PROVIDER_HTTP_429") return stopped("provider_rate_limited", 503);
    if (/^JEV_PROVIDER_HTTP_4\d\d$/.test(message)) return stopped("provider_request_rejected", 503);
    if (/^JEV_PROVIDER_HTTP_5\d\d$/.test(message)) return stopped("provider_unavailable", 503);
    if (name === "TimeoutError" || name === "AbortError") return stopped("provider_timeout", 503);
    return stopped("read_failed", 503);
  }
}
