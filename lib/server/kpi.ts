import "server-only";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { KPI_BUSINESSES, formatKpiValue, kpiBusiness, kpiLogLine, kpiLogTitle, monthRange, type KpiBusinessKey } from "@/lib/kpi";
import { activeRuns, salesRuns, type SalesRun } from "@/lib/kpi-runs";
import { authenticateRequest } from "./auth";

// Staff (not partners) read and manage KPIs, amounts included (owner decision 2026-10-25).
export async function kpiActor(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "USER_SESSION_REQUIRED", "직원 로그인으로 열어 주세요.");
  const { data, error } = await createServiceSupabase().from("os_profiles").select("display_name,member_kind,is_active,role,finance_access").eq("id", actor.id).single();
  if (error || !data?.is_active || data.member_kind === "partner") throw new ApiError(403, "KPI_FORBIDDEN", "KPI는 사내 직원만 볼 수 있습니다.");
  // Settlements, fees and single payments stay on the finance screens for admins and finance members.
  return { ...actor, displayName: String(data.display_name ?? "구성원"), canSeeFinance: data.role === "admin" || data.finance_access === true };
}

export type KpiRevenue = { net: number; paid: number; canceled: number; count: number; canceledCount: number; syncedAt: string | null };
// Net sales of the month from the Toss ledger: orders paid that month, less what was canceled.
export async function monthRevenue(month: string) {
  const { from, to } = monthRange(month), db = createServiceSupabase();
  const [{ data, error }, { data: stores, error: storeError }] = await Promise.all([
    db.from("os_fin_payments").select("biz,amount,canceled_amount,status").gte("paid_date", from).lte("paid_date", to).is("archived_at", null).limit(10000),
    db.from("os_fin_stores").select("biz,last_tx_synced_at"),
  ]);
  if (error || storeError) throw new ApiError(503, "KPI_REVENUE_UNAVAILABLE", "매출을 불러오지 못했습니다.");
  return Object.fromEntries(KPI_BUSINESSES.map(business => {
    const rows = (data ?? []).filter(row => row.biz === business.key && row.status !== "WAITING_FOR_DEPOSIT");
    const paid = rows.reduce((sum, row) => sum + Number(row.amount), 0), canceled = rows.reduce((sum, row) => sum + Number(row.canceled_amount ?? 0), 0);
    // Totals only: individual payments carry customer data and stay on the finance screens.
    return [business.key, { net: paid - canceled, paid, canceled, count: rows.length, canceledCount: rows.filter(row => Number(row.canceled_amount) > 0).length,
      syncedAt: (stores ?? []).find(store => store.biz === business.key)?.last_tx_synced_at ?? null }];
  })) as Record<KpiBusinessKey, KpiRevenue>;
}

// 브랜디에듀 sales rounds, found from the Toss ledger (lib/kpi-runs). A person's settings for a
// round (name, course dates; os_records goal, metadata kind "cohort") anchor to the round that
// contains their anchor day; split days per product live in a kind "product_split" row.
export type RoundSettings = { id: string; name: string; courseFrom: string | null; courseTo: string | null; version: number };
export type SalesRound = SalesRun & { label: string; settings: RoundSettings | null; courseTo: string | null; syncedAt: string | null };
export async function eduRounds(): Promise<SalesRound[]> {
  const db = createServiceSupabase();
  const [{ data: payments, error }, { data: rows, error: rowError }, { data: store }] = await Promise.all([
    db.from("os_fin_payments").select("order_name,paid_date,amount,canceled_amount,status").eq("biz", "edu").is("archived_at", null).limit(20000),
    db.from("os_records").select("id,title,version,metadata").eq("record_type", "goal").eq("metadata->>workspace", "kpi").in("metadata->>kind", ["cohort", "product_split"]).is("archived_at", null),
    db.from("os_fin_stores").select("last_tx_synced_at").eq("biz", "edu").maybeSingle(),
  ]);
  if (error || rowError) throw new ApiError(503, "KPI_ROUNDS_UNAVAILABLE", "판매 회차를 불러오지 못했습니다.");
  const splits: Record<string, string[]> = {};
  for (const row of (rows ?? []).filter(item => item.metadata.kind === "product_split")) splits[String(row.metadata.product)] = (row.metadata.splits ?? []) as string[];
  const settings = (rows ?? []).filter(item => item.metadata.kind === "cohort");
  const runs = salesRuns((payments ?? []).filter(row => row.status !== "WAITING_FOR_DEPOSIT").map(row => ({
    product: String(row.order_name ?? ""), day: String(row.paid_date), amount: Number(row.amount), canceled: Number(row.canceled_amount ?? 0) })), splits);
  return runs.map(run => {
    const found = settings.find(item => String(item.metadata.product) === run.product && run.from <= String(item.metadata.anchor ?? item.metadata.salesFrom) && String(item.metadata.anchor ?? item.metadata.salesFrom) <= run.to);
    const own = found ? { id: found.id, name: found.title, version: found.version,
      courseFrom: (found.metadata.courseFrom as string) || null, courseTo: (found.metadata.courseTo as string) || null } : null;
    return { ...run, settings: own, courseTo: own?.courseTo ?? null, syncedAt: store?.last_tx_synced_at ?? null,
      label: own?.name ?? `${run.product} · ${run.from.slice(5).replace("-", "/")}~${run.to.slice(5).replace("-", "/")} 판매분` };
  });
}
// The settings row of a round, created the first time a person names it or sets a target.
export async function ensureRoundSettings(round: SalesRound, actorId: string) {
  if (round.settings) return round.settings;
  const { data, error } = await createServiceSupabase().from("os_records").insert({ record_type: "goal", title: round.label, description: "", status: "active", priority: "normal",
    brand: kpiBusiness("edu")!.brand, owner_id: actorId, created_by: actorId, updated_by: actorId,
    metadata: { workspace: "kpi", kind: "cohort", business: "edu", product: round.product, anchor: round.from } }).select("id,title,version").single();
  if (error || !data) throw new ApiError(503, "KPI_ROUND_SAVE_FAILED", "판매 회차를 저장하지 못했습니다.");
  return { id: data.id as string, name: data.title as string, version: data.version as number, courseFrom: null, courseTo: null };
}

// Append to the scope's log (a month of a business, or a cohort), a team document every member
// reads. The first line creates it. A version race is retried once on the new version.
export type KpiLogScope = { key: string; label: string };
export async function appendKpiLog(businessKey: KpiBusinessKey, scope: KpiLogScope, ownerId: string, who: string, text: string, at = new Date()) {
  const db = createServiceSupabase(), { title, folder } = kpiLogTitle(businessKey, scope.label), sourceRef = `kpi:${businessKey}:${scope.key}`;
  const line = kpiLogLine(at, who, text);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: current, error } = await db.from("os_documents").select("id,content_md,current_version").eq("source", "kpi_log").eq("source_ref", sourceRef).neq("status", "archived").maybeSingle();
    if (error) throw new ApiError(503, "KPI_LOG_UNAVAILABLE", "KPI 로그를 읽지 못했습니다.");
    if (!current) {
      const business = kpiBusiness(businessKey)!;
      const content = [`# ${title}`, "", `${business.label} · ${scope.label}의 KPI 변경과 매일 아침 토스 매출 누적을 한 줄씩 남깁니다. 지난 줄은 고치지 않습니다.`, "", line].join("\n");
      const { error: insertError } = await db.from("os_documents").insert({ title, content_md: content, folder, status: "team", source: "kpi_log", source_ref: sourceRef,
        owner_id: ownerId, created_by: ownerId, brand: business.brand, team: "", tags: ["KPI", business.label] });
      if (!insertError) return;
      continue;
    }
    const { data: saved } = await db.from("os_documents").update({ content_md: `${current.content_md.trimEnd()}\n${line}` })
      .eq("id", current.id).eq("current_version", current.current_version).select("id").maybeSingle();
    if (saved) return;
  }
  throw new ApiError(409, "KPI_LOG_CONFLICT", "KPI 로그가 동시에 바뀌어 기록하지 못했습니다. 다시 시도해 주세요.");
}

// After the morning sync: the month-to-date sales line for each business. A month's new log is
// owned by the first active admin.
export async function logDailyRevenue(at = new Date()) {
  const { data: admin } = await createServiceSupabase().from("os_profiles").select("id").eq("is_active", true).eq("role", "admin").order("id").limit(1).maybeSingle();
  if (!admin) throw new ApiError(503, "KPI_LOG_OWNER_MISSING", "KPI 로그를 만들 관리자를 찾지 못했습니다.");
  const ownerId = admin.id as string, day = at.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }), month = day.slice(0, 7), revenue = await monthRevenue(month);
  await appendKpiLog("myin", { key: month, label: month }, ownerId, "자동", `매출 누적 ${formatKpiValue(revenue.myin.net, "원")} (토스 결제 ${revenue.myin.count}건)`, at);
  // 브랜디에듀: each named round still selling or running.
  const rounds = await eduRounds();
  for (const round of activeRuns(rounds, day).filter(item => item.settings && rounds.length))
    await appendKpiLog("edu", { key: `cohort:${round.settings!.id}`, label: round.label }, ownerId, "자동", `회차 매출 누적 ${formatKpiValue(round.net, "원")} (결제 ${round.count}건)`, at);
}

// Tasks confirmed from meeting items that name a KPI: the item keeps kpiId, and the review
// creates the task with metadata.meetingItemId, so the link survives without a schema change.
export type KpiTask = { id: string; title: string; status: string; dueDate: string | null; assignee: string | null };
export async function kpiLinkedTasks(kpiIds: string[]) {
  const linked = new Map<string, KpiTask[]>(kpiIds.map(id => [id, []]));
  if (!kpiIds.length) return linked;
  const db = createServiceSupabase();
  const { data: meetings, error } = await db.from("os_records").select("metadata").eq("record_type", "meeting").eq("metadata->>workspace", "knowledge").is("archived_at", null).order("updated_at", { ascending: false }).limit(500);
  if (error) throw new ApiError(503, "KPI_TASKS_UNAVAILABLE", "KPI에 연결된 업무를 불러오지 못했습니다.");
  const itemKpi = new Map<string, string>();
  for (const meeting of meetings ?? []) for (const item of (meeting.metadata?.items ?? []) as { id?: string; kind?: string; kpiId?: string }[])
    if (item.kind === "task" && item.id && item.kpiId && linked.has(item.kpiId)) itemKpi.set(item.id, item.kpiId);
  if (!itemKpi.size) return linked;
  const { data: tasks, error: taskError } = await db.from("os_records").select("id,title,status,due_date,assignee_id,metadata").eq("record_type", "task")
    .in("metadata->>meetingItemId", [...itemKpi.keys()]).is("archived_at", null);
  if (taskError) throw new ApiError(503, "KPI_TASKS_UNAVAILABLE", "KPI에 연결된 업무를 불러오지 못했습니다.");
  const ids = [...new Set((tasks ?? []).map(task => task.assignee_id).filter(Boolean))];
  const { data: people } = ids.length ? await db.from("os_profiles").select("id,display_name").in("id", ids) : { data: [] };
  for (const task of tasks ?? []) linked.get(itemKpi.get(String(task.metadata?.meetingItemId))!)?.push({ id: task.id, title: task.title, status: task.status, dueDate: task.due_date,
    assignee: (people ?? []).find(person => person.id === task.assignee_id)?.display_name ?? null });
  return linked;
}
