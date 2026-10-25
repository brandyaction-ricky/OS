import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { formatKpiValue, kpiBusiness, kstMonth, validDay, validMonth, type KpiBusinessKey, type KpiCohort } from "@/lib/kpi";
import { appendKpiLog, cohortRevenue, kpiActor, kpiLinkedTasks, listCohorts, monthRevenue, type KpiLogScope, type KpiRevenue } from "@/lib/server/kpi";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KPIs (os_records kpi, metadata.workspace "kpi"). 마이인 KPIs belong to a month; 브랜디에듀 KPIs
// belong to a cohort (os_records goal, metadata.kind "cohort"). The revenue KPI's actual is the
// Toss net sales of that month or cohort, computed on read; every other actual is entered.
// Each change is appended to the scope's KPI log document.
type KpiRow = { id: string; title: string; metric_target: number | null; metric_current: number | null; metric_unit: string; version: number; updated_at: string; created_by: string; metadata: Record<string, unknown> };
const FIELDS = "id,title,metric_target,metric_current,metric_unit,version,updated_at,created_by,metadata";
const db = () => createServiceSupabase();

async function logIds(refs: string[]) {
  const { data } = await db().from("os_documents").select("id,source_ref").eq("source", "kpi_log").in("source_ref", refs).neq("status", "archived");
  return new Map((data ?? []).map(row => [row.source_ref as string, row.id as string]));
}
function present(rows: KpiRow[], revenue: KpiRevenue, tasks: Map<string, unknown[]>) {
  return rows.map(row => ({ id: row.id, title: row.title, unit: row.metric_unit, target: row.metric_target, version: row.version, updatedAt: row.updated_at,
    metric: row.metadata.metric === "revenue" ? "revenue" : "manual", current: row.metadata.metric === "revenue" ? revenue.net : row.metric_current, tasks: tasks.get(row.id) ?? [] }));
}

export async function GET(request: Request) {
  try {
    const actor = await kpiActor(request);
    const value = new URL(request.url).searchParams.get("month"), month = validMonth(value) ? value! : kstMonth();
    const cohorts = await listCohorts();
    const [{ data, error }, revenue, cohortSales, logs] = await Promise.all([
      db().from("os_records").select(FIELDS).eq("record_type", "kpi").eq("metadata->>workspace", "kpi").is("archived_at", null)
        .or(`metadata->>periodMonth.eq.${month},metadata->>cohortId.in.(${cohorts.map(cohort => cohort.id).join(",") || "00000000-0000-0000-0000-000000000000"})`).order("created_at"),
      monthRevenue(month),
      Promise.all(cohorts.map(cohort => cohortRevenue(cohort))),
      logIds([`kpi:myin:${month}`, ...cohorts.map(cohort => `kpi:edu:cohort:${cohort.id}`)]),
    ]);
    if (error) throw new ApiError(503, "KPI_UNAVAILABLE", "KPI를 불러오지 못했습니다.");
    const rows = (data ?? []) as KpiRow[], tasks = await kpiLinkedTasks(rows.map(row => row.id));
    return NextResponse.json({ month, canSeeFinance: actor.canSeeFinance, businesses: [
      { key: "myin", label: "마이인", mode: "month", revenue: revenue.myin, logDocumentId: logs.get(`kpi:myin:${month}`) ?? null,
        kpis: present(rows.filter(row => row.metadata.business === "myin" && row.metadata.periodMonth === month), revenue.myin, tasks) },
      { key: "edu", label: "브랜디에듀", mode: "cohort", monthRevenue: revenue.edu,
        cohorts: cohorts.map((cohort, index) => ({ ...cohort, revenue: cohortSales[index], logDocumentId: logs.get(`kpi:edu:cohort:${cohort.id}`) ?? null,
          kpis: present(rows.filter(row => row.metadata.cohortId === cohort.id), cohortSales[index], tasks) })) },
    ] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

const amount = z.number().finite().min(0).max(1e13).nullable();
const cohortFields = { name: z.string().trim().min(1).max(80), product: z.string().trim().max(120).default(""),
  salesFrom: z.string().refine(validDay), salesTo: z.string().refine(validDay), courseFrom: z.string().refine(validDay), courseTo: z.string().refine(validDay) };
const createSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("kpi"), business: z.enum(["myin", "edu"]), month: z.string().refine(v => validMonth(v)).optional(), cohortId: z.string().uuid().optional(),
    metric: z.enum(["revenue", "manual"]), title: z.string().trim().min(1).max(80), unit: z.string().trim().max(10).default(""), target: amount, current: amount.optional() }).strict(),
  z.object({ action: z.literal("cohort"), ...cohortFields }).strict(),
]);
const updateSchema = z.object({
  id: z.string().uuid(), expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(80).optional(), target: amount.optional(), current: amount.optional(), archive: z.literal(true).optional(),
  cohort: z.object(cohortFields).partial().strict().optional(),
}).strict();
const cohortLabel = (c: Pick<KpiCohort, "product" | "salesFrom" | "salesTo" | "courseFrom" | "courseTo">) =>
  `상품 ${c.product || "전체"} · 모집 ${c.salesFrom}~${c.salesTo} · 교육 ${c.courseFrom}~${c.courseTo}`;
const orderedDays = (c: Pick<KpiCohort, "salesFrom" | "salesTo" | "courseFrom" | "courseTo">) => c.salesFrom <= c.salesTo && c.courseFrom <= c.courseTo;

async function scopeOf(business: KpiBusinessKey, month?: string, cohortId?: string): Promise<{ scope: KpiLogScope; meta: Record<string, string> }> {
  if (business === "myin") {
    if (!month) throw new ApiError(422, "KPI_MONTH_REQUIRED", "마이인 KPI는 달을 정해 주세요.");
    return { scope: { key: month, label: month }, meta: { periodMonth: month } };
  }
  const cohort = (await listCohorts()).find(item => item.id === cohortId);
  if (!cohort) throw new ApiError(422, "KPI_COHORT_REQUIRED", "브랜디에듀 KPI는 기수를 골라 주세요.");
  return { scope: { key: `cohort:${cohort.id}`, label: cohort.name }, meta: { cohortId: cohort.id } };
}

export async function POST(request: Request) {
  try {
    const actor = await kpiActor(request), input = createSchema.parse(await parseJson(request, 4000));
    if (input.action === "cohort") {
      if (!orderedDays(input)) throw new ApiError(422, "KPI_COHORT_DATES", "모집·교육 기간의 시작일이 끝나는 날보다 늦습니다.");
      const { data, error } = await db().from("os_records").insert({ record_type: "goal", title: input.name, description: "", status: "active", priority: "normal", brand: kpiBusiness("edu")!.brand,
        owner_id: actor.id, created_by: actor.id, updated_by: actor.id,
        metadata: { workspace: "kpi", kind: "cohort", business: "edu", product: input.product, salesFrom: input.salesFrom, salesTo: input.salesTo, courseFrom: input.courseFrom, courseTo: input.courseTo } }).select("id").single();
      if (error || !data) throw new ApiError(503, "KPI_COHORT_SAVE_FAILED", "기수를 저장하지 못했습니다.");
      await appendKpiLog("edu", { key: `cohort:${data.id}`, label: input.name }, actor.id, actor.displayName, `기수 추가 · ${cohortLabel(input)}`);
      return NextResponse.json({ id: data.id }, { status: 201 });
    }
    const { scope, meta } = await scopeOf(input.business, input.month, input.cohortId), revenue = input.metric === "revenue";
    if (revenue) {
      let query = db().from("os_records").select("id").eq("record_type", "kpi").eq("metadata->>workspace", "kpi").eq("metadata->>business", input.business).eq("metadata->>metric", "revenue").is("archived_at", null);
      for (const [key, value] of Object.entries(meta)) query = query.eq(`metadata->>${key}`, value);
      const { data: existing } = await query.limit(1).maybeSingle();
      if (existing) throw new ApiError(409, "KPI_REVENUE_EXISTS", "이미 매출 KPI가 있습니다. 목표를 고쳐 주세요.");
    }
    const title = revenue ? (input.business === "edu" ? "기수 매출" : "순매출") : input.title, unit = revenue ? "원" : input.unit;
    const { data, error } = await db().from("os_records").insert({
      record_type: "kpi", title, description: "", status: "active", priority: "normal", brand: kpiBusiness(input.business)!.brand,
      owner_id: actor.id, created_by: actor.id, updated_by: actor.id, metric_target: input.target, metric_current: revenue ? null : input.current ?? null, metric_unit: unit,
      metadata: { workspace: "kpi", business: input.business, metric: input.metric, ...meta },
    }).select("id").single();
    if (error || !data) throw new ApiError(503, "KPI_SAVE_FAILED", "KPI를 저장하지 못했습니다.");
    await appendKpiLog(input.business, scope, actor.id, actor.displayName,
      `${title} KPI 추가 · 목표 ${formatKpiValue(input.target, unit)}${!revenue && input.current != null ? ` · 실적 ${formatKpiValue(input.current, unit)}` : ""}`);
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KPI", "KPI 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await kpiActor(request), input = updateSchema.parse(await parseJson(request, 4000));
    const { data: row } = await db().from("os_records").select(FIELDS).eq("id", input.id).in("record_type", ["kpi", "goal"]).eq("metadata->>workspace", "kpi").is("archived_at", null).maybeSingle();
    if (!row) throw new ApiError(404, "KPI_NOT_FOUND", "KPI를 찾을 수 없습니다.");
    const kpi = row as KpiRow, isCohort = kpi.metadata.kind === "cohort";
    if (kpi.version !== input.expectedVersion) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    if (input.archive && actor.role !== "admin" && kpi.created_by !== actor.id) throw new ApiError(403, "KPI_ARCHIVE_FORBIDDEN", "만든 사람이나 관리자만 지울 수 있습니다.");
    const changes: Record<string, unknown> = { updated_by: actor.id }, notes: string[] = [];
    let scope: KpiLogScope, business: KpiBusinessKey;
    if (isCohort) {
      business = "edu";
      const next = { ...kpi.metadata, ...input.cohort } as unknown as KpiCohort;
      if (input.cohort) {
        if (!orderedDays(next)) throw new ApiError(422, "KPI_COHORT_DATES", "모집·교육 기간의 시작일이 끝나는 날보다 늦습니다.");
        changes.metadata = { ...kpi.metadata, ...input.cohort, name: undefined };
        if (input.cohort.name && input.cohort.name !== kpi.title) { changes.title = input.cohort.name; notes.push(`이름 ${kpi.title} → ${input.cohort.name}`); }
        notes.push(cohortLabel(next));
      }
      scope = { key: `cohort:${kpi.id}`, label: kpi.title };
    } else {
      business = kpi.metadata.business as KpiBusinessKey;
      const revenue = kpi.metadata.metric === "revenue", unit = kpi.metric_unit;
      if (revenue && (input.current !== undefined || input.title !== undefined)) throw new ApiError(422, "KPI_REVENUE_AUTO", "매출 실적은 토스 매출로 자동 계산됩니다. 목표만 고칠 수 있습니다.");
      if (input.title !== undefined && input.title !== kpi.title) { changes.title = input.title; notes.push(`이름 ${kpi.title} → ${input.title}`); }
      if (input.target !== undefined && input.target !== kpi.metric_target) { changes.metric_target = input.target; notes.push(`목표 ${formatKpiValue(kpi.metric_target, unit)} → ${formatKpiValue(input.target, unit)}`); }
      if (input.current !== undefined && input.current !== kpi.metric_current) { changes.metric_current = input.current; notes.push(`실적 ${formatKpiValue(kpi.metric_current, unit)} → ${formatKpiValue(input.current, unit)}`); }
      ({ scope } = await scopeOf(business, kpi.metadata.periodMonth as string | undefined, kpi.metadata.cohortId as string | undefined));
    }
    if (input.archive) { changes.archived_at = new Date().toISOString(); notes.push(isCohort ? "기수 삭제" : "KPI 삭제"); }
    if (!notes.length) return NextResponse.json({ unchanged: true });
    const { data: saved } = await db().from("os_records").update(changes).eq("id", kpi.id).eq("version", kpi.version).select("id").maybeSingle();
    if (!saved) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    await appendKpiLog(business, scope, actor.id, actor.displayName, `${isCohort ? "기수" : (input.title ?? kpi.title)} · ${notes.join(" · ")}`);
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KPI", "KPI 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
