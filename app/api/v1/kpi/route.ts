import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { formatKpiValue, kpiBusiness, kstMonth, validDay, validMonth, type KpiBusinessKey } from "@/lib/kpi";
import { appendKpiLog, eduRounds, ensureRoundSettings, kpiActor, kpiLinkedTasks, monthRevenue, type KpiLogScope, type KpiRevenue, type SalesRound } from "@/lib/server/kpi";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KPIs (os_records kpi, metadata.workspace "kpi"). 마이인 KPIs belong to a month. 브랜디에듀 KPIs
// belong to a sales round found automatically from the Toss ledger (product + selling period);
// a round's settings row (name, course dates) is created the first time someone touches it, and
// its KPIs point to that row (metadata.cohortId). A revenue KPI's actual is computed on read;
// every other actual is entered. Each change is appended to the scope's KPI log document.
type KpiRow = { id: string; title: string; metric_target: number | null; metric_current: number | null; metric_unit: string; version: number; updated_at: string; created_by: string; metadata: Record<string, unknown> };
const FIELDS = "id,title,metric_target,metric_current,metric_unit,version,updated_at,created_by,metadata";
const db = () => createServiceSupabase();
const SHOWN_ROUNDS = 12;

async function logIds(refs: string[]) {
  const { data } = await db().from("os_documents").select("id,source_ref").eq("source", "kpi_log").in("source_ref", refs).neq("status", "archived");
  return new Map((data ?? []).map(row => [row.source_ref as string, row.id as string]));
}
function present(rows: KpiRow[], net: number, tasks: Map<string, unknown[]>) {
  return rows.map(row => ({ id: row.id, title: row.title, unit: row.metric_unit, target: row.metric_target, version: row.version, updatedAt: row.updated_at,
    metric: row.metadata.metric === "revenue" ? "revenue" : "manual", current: row.metadata.metric === "revenue" ? net : row.metric_current, tasks: tasks.get(row.id) ?? [] }));
}
const revenueOf = (round: SalesRound): KpiRevenue => ({ net: round.net, paid: round.paid, canceled: round.canceled, count: round.count, canceledCount: round.canceledCount, syncedAt: round.syncedAt });

export async function GET(request: Request) {
  try {
    const actor = await kpiActor(request);
    const value = new URL(request.url).searchParams.get("month"), month = validMonth(value) ? value! : kstMonth();
    const rounds = (await eduRounds()).slice(0, SHOWN_ROUNDS), settingIds = rounds.flatMap(round => round.settings ? [round.settings.id] : []);
    const [{ data, error }, revenue, logs] = await Promise.all([
      db().from("os_records").select(FIELDS).eq("record_type", "kpi").eq("metadata->>workspace", "kpi").is("archived_at", null)
        .or(`metadata->>periodMonth.eq.${month},metadata->>cohortId.in.(${settingIds.join(",") || "00000000-0000-0000-0000-000000000000"})`).order("created_at"),
      monthRevenue(month),
      logIds([`kpi:myin:${month}`, ...settingIds.map(id => `kpi:edu:cohort:${id}`)]),
    ]);
    if (error) throw new ApiError(503, "KPI_UNAVAILABLE", "KPI를 불러오지 못했습니다.");
    const rows = (data ?? []) as KpiRow[], tasks = await kpiLinkedTasks(rows.map(row => row.id));
    return NextResponse.json({ month, canSeeFinance: actor.canSeeFinance, businesses: [
      { key: "myin", label: "마이인", mode: "month", revenue: revenue.myin, logDocumentId: logs.get(`kpi:myin:${month}`) ?? null,
        kpis: present(rows.filter(row => row.metadata.business === "myin" && row.metadata.periodMonth === month), revenue.myin.net, tasks) },
      { key: "edu", label: "브랜디에듀", mode: "rounds", rounds: rounds.map(round => ({
        key: round.key, product: round.product, from: round.from, to: round.to, label: round.label, named: !!round.settings,
        settingsId: round.settings?.id ?? null, courseFrom: round.settings?.courseFrom ?? null, courseTo: round.settings?.courseTo ?? null,
        revenue: revenueOf(round), logDocumentId: round.settings ? logs.get(`kpi:edu:cohort:${round.settings.id}`) ?? null : null,
        kpis: round.settings ? present(rows.filter(row => row.metadata.cohortId === round.settings!.id), round.net, tasks) : [] })) },
    ] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

const amount = z.number().finite().min(0).max(1e13).nullable();
const day = z.string().refine(validDay);
const createSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("kpi"), business: z.enum(["myin", "edu"]), month: z.string().refine(v => validMonth(v)).optional(), roundKey: z.string().max(400).optional(),
    metric: z.enum(["revenue", "manual"]), title: z.string().trim().min(1).max(80), unit: z.string().trim().max(10).default(""), target: amount, current: amount.optional() }).strict(),
  // Name a round or set its course dates (creates its settings row the first time).
  z.object({ action: z.literal("round"), roundKey: z.string().max(400), name: z.string().trim().min(1).max(80).optional(),
    courseFrom: day.nullable().optional(), courseTo: day.nullable().optional() }).strict(),
  // Cut a product's sales into two rounds from this day on.
  z.object({ action: z.literal("split"), product: z.string().trim().min(1).max(200), day }).strict(),
]);
const updateSchema = z.object({
  id: z.string().uuid(), expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(80).optional(), target: amount.optional(), current: amount.optional(), archive: z.literal(true).optional(),
}).strict();

async function roundOf(roundKey: string | undefined) {
  const round = (await eduRounds()).find(item => item.key === roundKey);
  if (!round) throw new ApiError(422, "KPI_ROUND_REQUIRED", "판매 회차를 찾을 수 없습니다. 새로 불러온 뒤 다시 골라 주세요.");
  return round;
}

export async function POST(request: Request) {
  try {
    const actor = await kpiActor(request), input = createSchema.parse(await parseJson(request, 4000));
    if (input.action === "split") {
      const { data: existing } = await db().from("os_records").select("id,version,metadata").eq("record_type", "goal").eq("metadata->>workspace", "kpi")
        .eq("metadata->>kind", "product_split").eq("metadata->>product", input.product).is("archived_at", null).maybeSingle();
      const splits = [...new Set([...((existing?.metadata.splits ?? []) as string[]), input.day])].sort();
      const { error } = existing
        ? await db().from("os_records").update({ metadata: { ...existing.metadata, splits }, updated_by: actor.id }).eq("id", existing.id).eq("version", existing.version)
        : await db().from("os_records").insert({ record_type: "goal", title: `${input.product} 회차 나누기`, description: "", status: "active", priority: "normal", brand: kpiBusiness("edu")!.brand,
            owner_id: actor.id, created_by: actor.id, updated_by: actor.id, metadata: { workspace: "kpi", kind: "product_split", business: "edu", product: input.product, splits } });
      if (error) throw new ApiError(503, "KPI_SPLIT_FAILED", "회차를 나누지 못했습니다.");
      return NextResponse.json({ splits });
    }
    if (input.action === "round") {
      const round = await roundOf(input.roundKey), own = await ensureRoundSettings(round, actor.id);
      const { data: row } = await db().from("os_records").select("version,metadata,title").eq("id", own.id).single();
      const metadata = { ...row!.metadata, ...(input.courseFrom !== undefined ? { courseFrom: input.courseFrom } : {}), ...(input.courseTo !== undefined ? { courseTo: input.courseTo } : {}) };
      if (metadata.courseFrom && metadata.courseTo && metadata.courseFrom > metadata.courseTo) throw new ApiError(422, "KPI_COURSE_DATES", "교육 시작일이 끝나는 날보다 늦습니다.");
      const name = input.name ?? row!.title;
      const { data: saved } = await db().from("os_records").update({ title: name, metadata, updated_by: actor.id }).eq("id", own.id).eq("version", row!.version).select("id").maybeSingle();
      if (!saved) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
      await appendKpiLog("edu", { key: `cohort:${own.id}`, label: name }, actor.id, actor.displayName,
        `회차 설정 · ${round.product} · 판매 ${round.from}~${round.to}${metadata.courseFrom ? ` · 교육 ${metadata.courseFrom}~${metadata.courseTo ?? ""}` : ""}${input.name && input.name !== row!.title ? ` · 이름 ${row!.title} → ${input.name}` : ""}`);
      return NextResponse.json({ id: own.id });
    }
    let scope: KpiLogScope, meta: Record<string, string>;
    if (input.business === "myin") {
      if (!input.month) throw new ApiError(422, "KPI_MONTH_REQUIRED", "마이인 KPI는 달을 정해 주세요.");
      scope = { key: input.month, label: input.month }; meta = { periodMonth: input.month };
    } else {
      const round = await roundOf(input.roundKey), own = await ensureRoundSettings(round, actor.id);
      scope = { key: `cohort:${own.id}`, label: own.name }; meta = { cohortId: own.id };
    }
    const revenue = input.metric === "revenue";
    if (revenue) {
      let query = db().from("os_records").select("id").eq("record_type", "kpi").eq("metadata->>workspace", "kpi").eq("metadata->>business", input.business).eq("metadata->>metric", "revenue").is("archived_at", null);
      for (const [key, value] of Object.entries(meta)) query = query.eq(`metadata->>${key}`, value);
      const { data: existing } = await query.limit(1).maybeSingle();
      if (existing) throw new ApiError(409, "KPI_REVENUE_EXISTS", "이미 매출 KPI가 있습니다. 목표를 고쳐 주세요.");
    }
    const title = revenue ? (input.business === "edu" ? "회차 매출" : "순매출") : input.title, unit = revenue ? "원" : input.unit;
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
    const { data: row } = await db().from("os_records").select(FIELDS).eq("id", input.id).eq("record_type", "kpi").eq("metadata->>workspace", "kpi").is("archived_at", null).maybeSingle();
    if (!row) throw new ApiError(404, "KPI_NOT_FOUND", "KPI를 찾을 수 없습니다.");
    const kpi = row as KpiRow, business = kpi.metadata.business as KpiBusinessKey, revenue = kpi.metadata.metric === "revenue", unit = kpi.metric_unit;
    if (kpi.version !== input.expectedVersion) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    if (input.archive && actor.role !== "admin" && kpi.created_by !== actor.id) throw new ApiError(403, "KPI_ARCHIVE_FORBIDDEN", "만든 사람이나 관리자만 지울 수 있습니다.");
    if (revenue && (input.current !== undefined || input.title !== undefined)) throw new ApiError(422, "KPI_REVENUE_AUTO", "매출 실적은 토스 매출로 자동 계산됩니다. 목표만 고칠 수 있습니다.");
    const changes: Record<string, unknown> = { updated_by: actor.id }, notes: string[] = [];
    if (input.title !== undefined && input.title !== kpi.title) { changes.title = input.title; notes.push(`이름 ${kpi.title} → ${input.title}`); }
    if (input.target !== undefined && input.target !== kpi.metric_target) { changes.metric_target = input.target; notes.push(`목표 ${formatKpiValue(kpi.metric_target, unit)} → ${formatKpiValue(input.target, unit)}`); }
    if (input.current !== undefined && input.current !== kpi.metric_current) { changes.metric_current = input.current; notes.push(`실적 ${formatKpiValue(kpi.metric_current, unit)} → ${formatKpiValue(input.current, unit)}`); }
    if (input.archive) { changes.archived_at = new Date().toISOString(); notes.push("KPI 삭제"); }
    if (!notes.length) return NextResponse.json({ unchanged: true });
    const { data: saved } = await db().from("os_records").update(changes).eq("id", kpi.id).eq("version", kpi.version).select("id").maybeSingle();
    if (!saved) throw new ApiError(409, "KPI_CHANGED", "다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    let scope: KpiLogScope = { key: String(kpi.metadata.periodMonth), label: String(kpi.metadata.periodMonth) };
    if (kpi.metadata.cohortId) {
      const { data: setting } = await db().from("os_records").select("title").eq("id", String(kpi.metadata.cohortId)).maybeSingle();
      scope = { key: `cohort:${kpi.metadata.cohortId}`, label: String(setting?.title ?? "판매 회차") };
    }
    await appendKpiLog(business, scope, actor.id, actor.displayName, `${input.title ?? kpi.title} · ${notes.join(" · ")}`);
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KPI", "KPI 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
