import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { resolveMeetingBusiness } from "@/lib/meeting-business";
import { buildPerformanceSignal } from "@/lib/performance-signals";

// Shared by the web meeting workspace (app/api/v1/meeting-prep) and the
// Telegram /회의준비 command, so both surfaces build the same prep brief.

/** 문서 안의 "## {heading}" 절만 잘라낸다. 못 찾으면 문서 앞부분을 그대로 쓴다. */
function extractSection(markdown: string, heading: string) {
  const match = markdown.match(new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
  return match ? match[1].trim() : markdown.slice(0, 1000).trim();
}

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
  let latestSummary = typeof latest?.metadata?.summary === "string" ? latest.metadata.summary : "";
  let latestTitle = latest?.title ?? "";
  let latestDate = latest?.starts_at ?? null;

  // os_records에 구조화된 회의가 아직 없으면(옛 봇·옵시디언 시절 회의는 os_records로
  // 옮겨진 적이 없다), 같은 사업의 지식문서함 "주간 회의 요약"에서 가장 최근 문서를
  // 대신 보여준다. 완전히 다른 데이터 없음보다는 낫다.
  const business = brand ? resolveMeetingBusiness(brand) : null;
  if (!latestSummary && business) {
    const { data: doc } = await supabase
      .from("os_documents")
      .select("title,content_md,updated_at")
      .like("folder", `02_Wiki/${business.wikiFolderSegment}/운영/주간회의요약%`)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (doc?.content_md) {
      latestSummary = extractSection(doc.content_md, "핵심 요약");
      latestTitle = doc.title ?? latestTitle;
      latestDate = latestDate ?? doc.updated_at ?? null;
    }
  }

  const openTodos = (tasks.data ?? []).filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 30);
  const latestKpis = (kpis.data ?? []).slice(0, 12).map((item) => {
    const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata?.previousValue ?? 0);
    const signal = buildPerformanceSignal({ title: item.title, current, previous, target: Number(item.metric_target ?? 0) || null, unit: item.metric_unit });
    return { id: item.id, title: item.title, current, previous, unit: item.metric_unit, signal: signal.label };
  });
  return { latestMeeting: (latest || latestSummary) ? { id: latest?.id ?? "", title: latestTitle, date: latestDate, pending, summary: latestSummary } : null, pending, todos: openTodos, kpis: latestKpis };
}
