import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { buildPerformanceSignal } from "@/lib/performance-signals";

// Shared by the web meeting workspace (app/api/v1/meeting-prep) and the
// Telegram /회의준비 command, so both surfaces build the same prep brief.

export interface MeetingPrepKpi { id: string; title: string; current: number; previous: number; unit: string; signal: string }
export interface MeetingPrepResult {
  latestMeeting: { id: string; title: string; date: string | null; pending: string[]; summary: string } | null;
  pending: string[];
  todos: Array<Record<string, unknown>>;
  kpis: MeetingPrepKpi[];
}

/** 지난 회의 미해결 + 완료 전 업무 + 최근 KPI 신호를 모아 다음 회의 준비 자료를 만든다. */
export async function prepareMeetingBrief(
  supabase: SupabaseClient,
  { brand = "", team = "" }: { brand?: string; team?: string } = {},
): Promise<MeetingPrepResult> {
  const scoped = (type: string, limit: number) => {
    let query = supabase.from("os_records").select("*").eq("record_type", type).is("archived_at", null).order("updated_at", { ascending: false }).limit(limit);
    if (brand) query = query.eq("brand", brand);
    if (team) query = query.eq("team", team);
    return query;
  };
  const [meetings, tasks, kpis] = await Promise.all([scoped("meeting", 10), scoped("task", 100), scoped("kpi", 20)]);
  const error = meetings.error || tasks.error || kpis.error;
  if (error) throw new ApiError(400, "MEETING_PREP_FAILED", "회의 준비 자료를 불러오지 못했습니다.", error.message);
  const latest = (meetings.data ?? []).find((item) => item.status === "done") ?? meetings.data?.[0] ?? null;
  const pending = Array.isArray(latest?.metadata?.pending) ? latest.metadata.pending.map(String) : [];
  const latestSummary = typeof latest?.metadata?.summary === "string" ? latest.metadata.summary : "";
  const openTodos = (tasks.data ?? []).filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 30);
  const latestKpis = (kpis.data ?? []).slice(0, 12).map((item) => {
    const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata?.previousValue ?? 0);
    const signal = buildPerformanceSignal({ title: item.title, current, previous, target: Number(item.metric_target ?? 0) || null, unit: item.metric_unit });
    return { id: item.id, title: item.title, current, previous, unit: item.metric_unit, signal: signal.label };
  });
  return { latestMeeting: latest ? { id: latest.id, title: latest.title, date: latest.starts_at, pending, summary: latestSummary } : null, pending, todos: openTodos, kpis: latestKpis };
}
