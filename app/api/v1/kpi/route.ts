import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { KPI_BUSINESSES, formatKpiValue, kpiBusiness, kstMonth, validMonth, type KpiBusinessKey } from "@/lib/kpi";
import { appendKpiLog, kpiActor, kpiLinkedTasks, monthRevenue } from "@/lib/server/kpi";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Monthly KPIs per business (os_records kpi, metadata.workspace "kpi"). The revenue KPI's actual
// is the Toss ledger's net sales, computed on read; every other actual is entered. Each change
// is appended to the business's monthly KPI log document.
type KpiRow = { id: string; title: string; brand: string; metric_target: number | null; metric_current: number | null; metric_unit: string; version: number; updated_at: string; created_by: string; metadata: Record<string, unknown> };
const FIELDS = "id,title,brand,metric_target,metric_current,metric_unit,version,updated_at,created_by,metadata";

export async function GET(request: Request) {
  try {
    await kpiActor(request);
    const value = new URL(request.url).searchParams.get("month"), month = validMonth(value) ? value! : kstMonth();
    const db = createServiceSupabase();
    const [{ data, error }, revenue, { data: logs }] = await Promise.all([
      db.from("os_records").select(FIELDS).eq("record_type", "kpi").eq("metadata->>workspace", "kpi").eq("metadata->>periodMonth", month).is("archived_at", null).order("created_at"),
      monthRevenue(month),
      db.from("os_documents").select("id,source_ref").eq("source", "kpi_log").in("source_ref", KPI_BUSINESSES.map(b => `kpi:${b.key}:${month}`)).neq("status", "archived"),
    ]);
    if (error) throw new ApiError(503, "KPI_UNAVAILABLE", "KPI를 불러오지 못했습니다.");
    const rows = (data ?? []) as KpiRow[], tasks = await kpiLinkedTasks(rows.map(row => row.id));
    return NextResponse.json({ month, businesses: KPI_BUSINESSES.map(business => ({
      key: business.key, label: business.label, revenue: revenue[business.key],
      logDocumentId: (logs ?? []).find(log => log.source_ref === `kpi:${business.key}:${month}`)?.id ?? null,
      kpis: rows.filter(row => row.metadata.business === business.key).map(row => ({
        id: row.id, title: row.title, unit: row.metric_unit, target: row.metric_target, version: row.version, updatedAt: row.updated_at,
        metric: row.metadata.metric === "revenue" ? "revenue" : "manual",
        current: row.metadata.metric === "revenue" ? revenue[business.key].net : row.metric_current,
        tasks: tasks.get(row.id) ?? [],
      })),
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

const amount = z.number().finite().min(0).max(1e13).nullable();
const createSchema = z.object({
  business: z.enum(["myin", "edu"]), month: z.string().refine(v => validMonth(v)), metric: z.enum(["revenue", "manual"]),
  title: z.string().trim().min(1).max(80), unit: z.string().trim().max(10).default(""), target: amount, current: amount.optional(),
}).strict();
const updateSchema = z.object({
  id: z.string().uuid(), expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(80).optional(), target: amount.optional(), current: amount.optional(), archive: z.literal(true).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const actor = await kpiActor(request), input = createSchema.parse(await parseJson(request, 4000)), db = createServiceSupabase();
    const business = kpiBusiness(input.business)!, revenue = input.metric === "revenue";
    if (revenue) {
      const { data: existing } = await db.from("os_records").select("id").eq("record_type", "kpi").eq("metadata->>workspace", "kpi")
        .eq("metadata->>business", input.business).eq("metadata->>periodMonth", input.month).eq("metadata->>metric", "revenue").is("archived_at", null).limit(1).maybeSingle();
      if (existing) throw new ApiError(409, "KPI_REVENUE_EXISTS", "이 달의 매출 KPI가 이미 있습니다. 목표를 고쳐 주세요.");
    }
    const title = revenue ? "순매출" : input.title, unit = revenue ? "원" : input.unit;
    const { data, error } = await db.from("os_records").insert({
      record_type: "kpi", title, description: "", status: "active", priority: "normal", brand: business.brand,
      owner_id: actor.id, created_by: actor.id, updated_by: actor.id, metric_target: input.target, metric_current: revenue ? null : input.current ?? null, metric_unit: unit,
      metadata: { workspace: "kpi", business: input.business, periodMonth: input.month, metric: input.metric },
    }).select("id").single();
    if (error || !data) throw new ApiError(503, "KPI_SAVE_FAILED", "KPI를 저장하지 못했습니다.");
    await appendKpiLog(input.business, input.month, actor.id, actor.displayName,
      `${title} KPI 추가 · 목표 ${formatKpiValue(input.target, unit)}${!revenue && input.current != null ? ` · 실적 ${formatKpiValue(input.current, unit)}` : ""}`);
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KPI", "KPI 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await kpiActor(request), input = updateSchema.parse(await parseJson(request, 4000)), db = createServiceSupabase();
    const { data: row } = await db.from("os_records").select(FIELDS).eq("id", input.id).eq("record_type", "kpi").eq("metadata->>workspace", "kpi").is("archived_at", null).maybeSingle();
    if (!row) throw new ApiError(404, "KPI_NOT_FOUND", "KPI를 찾을 수 없습니다.");
    const kpi = row as KpiRow, revenue = kpi.metadata.metric === "revenue", unit = kpi.metric_unit;
    if (kpi.version !== input.expectedVersion) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    if (input.archive && actor.role !== "admin" && kpi.created_by !== actor.id) throw new ApiError(403, "KPI_ARCHIVE_FORBIDDEN", "KPI는 만든 사람이나 관리자만 지울 수 있습니다.");
    if (revenue && (input.current !== undefined || input.title !== undefined)) throw new ApiError(422, "KPI_REVENUE_AUTO", "매출 실적은 토스 매출로 자동 계산됩니다. 목표만 고칠 수 있습니다.");
    const changes: Record<string, unknown> = { updated_by: actor.id }, notes: string[] = [];
    if (input.title !== undefined && input.title !== kpi.title) { changes.title = input.title; notes.push(`이름 ${kpi.title} → ${input.title}`); }
    if (input.target !== undefined && input.target !== kpi.metric_target) { changes.metric_target = input.target; notes.push(`목표 ${formatKpiValue(kpi.metric_target, unit)} → ${formatKpiValue(input.target, unit)}`); }
    if (input.current !== undefined && input.current !== kpi.metric_current) { changes.metric_current = input.current; notes.push(`실적 ${formatKpiValue(kpi.metric_current, unit)} → ${formatKpiValue(input.current, unit)}`); }
    if (input.archive) { changes.archived_at = new Date().toISOString(); notes.push("KPI 삭제"); }
    if (!notes.length) return NextResponse.json({ unchanged: true });
    const { data: saved } = await db.from("os_records").update(changes).eq("id", kpi.id).eq("version", kpi.version).select("id").maybeSingle();
    if (!saved) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    await appendKpiLog(kpi.metadata.business as KpiBusinessKey, String(kpi.metadata.periodMonth), actor.id, actor.displayName, `${input.title ?? kpi.title} · ${notes.join(" · ")}`);
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KPI", "KPI 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
