import "server-only";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { KPI_BUSINESSES, formatKpiValue, kpiBusiness, kpiLogLine, kpiLogTitle, monthRange, type KpiBusinessKey } from "@/lib/kpi";
import { authenticateRequest } from "./auth";

// Staff (not partners) read and manage KPIs, amounts included (owner decision 2026-10-25).
export async function kpiActor(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "USER_SESSION_REQUIRED", "직원 로그인으로 열어 주세요.");
  const { data, error } = await createServiceSupabase().from("os_profiles").select("display_name,member_kind,is_active").eq("id", actor.id).single();
  if (error || !data?.is_active || data.member_kind === "partner") throw new ApiError(403, "KPI_FORBIDDEN", "KPI는 사내 직원만 볼 수 있습니다.");
  return { ...actor, displayName: String(data.display_name ?? "구성원") };
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

// Append to the business's monthly log, a team document every member reads. The first line of
// a month creates it. An append that loses a version race is retried once on the new version.
export async function appendKpiLog(businessKey: KpiBusinessKey, month: string, ownerId: string, who: string, text: string, at = new Date()) {
  const db = createServiceSupabase(), { title, folder } = kpiLogTitle(businessKey, month), sourceRef = `kpi:${businessKey}:${month}`;
  const line = kpiLogLine(at, who, text);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: current, error } = await db.from("os_documents").select("id,content_md,current_version").eq("source", "kpi_log").eq("source_ref", sourceRef).neq("status", "archived").maybeSingle();
    if (error) throw new ApiError(503, "KPI_LOG_UNAVAILABLE", "KPI 로그를 읽지 못했습니다.");
    if (!current) {
      const business = kpiBusiness(businessKey)!;
      const content = [`# ${title}`, "", `${business.label}의 ${month} KPI 변경과 매일 아침 토스 매출 누적을 한 줄씩 남깁니다. 지난 줄은 고치지 않습니다.`, "", line].join("\n");
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
  const ownerId = admin.id as string, month = at.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7), revenue = await monthRevenue(month);
  for (const business of KPI_BUSINESSES)
    await appendKpiLog(business.key, month, ownerId, "자동", `매출 누적 ${formatKpiValue(revenue[business.key].net, "원")} (토스 결제 ${revenue[business.key].count}건)`, at);
}
