import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const legacyId = z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().min(1).max(200));
const optionalUrl = z.string().url().max(2_000).nullable().optional();
const metadata = z.record(z.unknown()).default({});

const snapshotSchema = z.object({
  version: z.literal(1).default(1),
  sources: z.array(z.object({
    id: legacyId,
    title: z.string().trim().min(1).max(240),
    description: z.string().max(20_000).default(""),
    status: z.string().trim().min(1).max(40).default("active"),
    brand: z.string().trim().max(120).default(""),
    team: z.string().trim().max(120).default("콘텐츠"),
    sourceUrl: optionalUrl,
    publishedAt: z.string().datetime().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    metadata,
  })).max(1_000).default([]),
  derivatives: z.array(z.object({
    id: legacyId,
    sourceId: legacyId,
    title: z.string().trim().min(1).max(240),
    body: z.string().max(20_000).default(""),
    platform: z.string().trim().min(1).max(80),
    format: z.string().trim().max(80).default(""),
    status: z.string().trim().min(1).max(40).default("review"),
    sourceUrl: optionalUrl,
    scheduledAt: z.string().datetime().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    metadata,
  })).max(3_000).default([]),
  metrics: z.array(z.object({
    id: legacyId,
    sourceId: legacyId.optional(),
    title: z.string().trim().min(1).max(240),
    platform: z.string().trim().max(80).default("YouTube"),
    views: z.number().finite().nonnegative().default(0),
    ctr: z.number().finite().min(0).max(100).default(0),
    retention: z.number().finite().min(0).max(100).default(0),
    conversions: z.number().finite().nonnegative().default(0),
    measuredAt: z.string().datetime().nullable().optional(),
    sourceUrl: optionalUrl,
    metadata,
  })).max(3_000).default([]),
});

type DatabaseRecord = Record<string, unknown> & { metadata: Record<string, unknown> };

function normalizedPublishStatus(status: string) {
  const aliases: Record<string, string> = {
    proposed: "review", pending: "review", approved: "ready", queued: "draft",
    complete: "published", completed: "published", rejected: "blocked",
    생성중: "draft", 검토대기: "review", 검토중: "review", 승인: "ready",
    승인완료: "ready", 예약: "scheduled", 발행: "published", 완료: "published", 반려: "blocked",
  };
  const normalized = aliases[status.toLowerCase()] ?? status.toLowerCase();
  return ["draft", "review", "ready", "scheduled", "published", "blocked"].includes(normalized) ? normalized : "review";
}

function normalizedSourceStatus(status: string) {
  return ({ 대기: "active", 파생생성중: "active", 운영중: "active", 완료: "done" } as Record<string, string>)[status] ?? status;
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 로컬 콘텐츠 스냅샷을 가져올 수 있습니다.");
    const input = snapshotSchema.parse(await parseJson(request, 5_000_000));
    if (!input.sources.length && !input.derivatives.length && !input.metrics.length) {
      throw new ApiError(400, "EMPTY_CONTENT_SNAPSHOT", "가져올 콘텐츠가 없습니다.");
    }

    const service = createServiceSupabase();
    const { data: existing, error: existingError } = await service
      .from("os_records")
      .select("id,record_type,metadata")
      .eq("metadata->>importSource", "radar_snapshot");
    if (existingError) throw new ApiError(400, "CONTENT_IMPORT_LOOKUP_FAILED", "기존 콘텐츠를 확인하지 못했습니다.", existingError.message);
    const existingByKey = new Map((existing ?? []).map((row) => [`${row.record_type}:${String(row.metadata?.legacyId ?? "")}`, row.id as string]));
    const sourceIds = new Map<string, string>();
    const counts = { created: 0, updated: 0, skipped: 0, sources: 0, derivatives: 0, metrics: 0 };

    const write = async (recordType: string, legacyKey: string, payload: DatabaseRecord) => {
      const key = `${recordType}:${legacyKey}`;
      const existingId = existingByKey.get(key);
      if (existingId) {
        const { data, error } = await service.from("os_records").update({ ...payload, updated_by: actor.id }).eq("id", existingId).select("id").single();
        if (error || !data) throw new ApiError(400, "CONTENT_IMPORT_UPDATE_FAILED", `기존 ${recordType} 항목을 갱신하지 못했습니다.`, error?.message);
        counts.updated += 1;
        return existingId;
      }
      const { data, error } = await service.from("os_records").insert({ ...payload, record_type: recordType, owner_id: actor.id, created_by: actor.id, updated_by: actor.id }).select("id").single();
      if (error || !data) throw new ApiError(400, "CONTENT_IMPORT_CREATE_FAILED", `새 ${recordType} 항목을 저장하지 못했습니다.`, error?.message);
      existingByKey.set(key, data.id);
      counts.created += 1;
      return data.id as string;
    };

    for (const source of input.sources) {
      const id = await write("content_topic", source.id, {
        title: source.title, description: source.description, status: normalizedSourceStatus(source.status), priority: "normal",
        stage: "원본 롱폼", brand: source.brand, team: source.team, source_url: source.sourceUrl ?? null,
        starts_at: source.publishedAt ?? null, tags: [...new Set(["롱폼", "로컬 동기화", ...source.tags])],
        metadata: { ...source.metadata, importSource: "radar_snapshot", legacyId: source.id, automationSource: true, importedAt: new Date().toISOString() },
      });
      sourceIds.set(source.id, id); counts.sources += 1;
    }

    for (const derivative of input.derivatives) {
      const parentId = sourceIds.get(derivative.sourceId) ?? existingByKey.get(`content_topic:${derivative.sourceId}`);
      if (!parentId) { counts.skipped += 1; continue; }
      await write("content_publish", derivative.id, {
        title: derivative.title, description: derivative.body, status: normalizedPublishStatus(derivative.status), priority: "normal",
        stage: derivative.format || derivative.platform, team: "콘텐츠", parent_id: parentId, source_url: derivative.sourceUrl ?? null,
        starts_at: derivative.scheduledAt ?? null, tags: [...new Set(["파생 콘텐츠", "로컬 동기화", ...derivative.tags])],
        metadata: { ...derivative.metadata, importSource: "radar_snapshot", legacyId: derivative.id, legacySourceId: derivative.sourceId, automationOutput: true, platform: derivative.platform, format: derivative.format || derivative.platform, finalApprovalRequired: true, importedAt: new Date().toISOString() },
      });
      counts.derivatives += 1;
    }

    for (const metric of input.metrics) {
      const parentId = metric.sourceId ? sourceIds.get(metric.sourceId) ?? existingByKey.get(`content_topic:${metric.sourceId}`) : undefined;
      await write("content_metric", metric.id, {
        title: metric.title, description: "로컬 성과 캐시에서 동기화", status: "measuring", priority: "normal", stage: "성과 측정",
        team: "콘텐츠", parent_id: parentId ?? null, source_url: metric.sourceUrl ?? null, starts_at: metric.measuredAt ?? null,
        metric_current: metric.views, metric_unit: "조회", tags: ["영상 성과", "로컬 동기화"],
        metadata: { ...metric.metadata, importSource: "radar_snapshot", legacyId: metric.id, legacySourceId: metric.sourceId ?? null, platform: metric.platform, views: metric.views, ctr: metric.ctr, retention: metric.retention, conversions: metric.conversions, importedAt: new Date().toISOString() },
      });
      counts.metrics += 1;
    }

    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_SNAPSHOT", "콘텐츠 스냅샷 형식을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
