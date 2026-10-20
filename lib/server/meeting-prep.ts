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

/** "## {heading}" 절을 "- " 글머리표 줄 목록으로 잘라낸다. "(없음)"이거나 없으면 빈 배열. */
function extractBulletList(markdown: string, heading: string) {
  const section = extractSection(markdown, heading);
  return section.split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter((line) => line && line !== "(없음)");
}

export interface MeetingPrepKpi { id: string; title: string; current: number; previous: number; unit: string; signal: string }
export interface MeetingPrepResult {
  latestMeeting: { id: string; title: string; date: string | null; pending: string[]; summary: string } | null;
  pending: string[];
  todos: Array<Record<string, unknown>>;
  completed: Array<Record<string, unknown>>;
  kpis: MeetingPrepKpi[];
  unreviewed: Array<{ id: string; title: string; date: string | null }>;
}

/** 지난 회의 미해결 + 완료 전 업무 + 최근 KPI 신호를 모아 다음 회의 준비 자료를 만든다. */
export async function prepareMeetingBrief(
  supabase: SupabaseClient,
  { brand = "", team = "" }: { brand?: string; team?: string } = {},
): Promise<MeetingPrepResult> {
  const scoped = (type: string, limit: number) => {
    let query = supabase.from("os_records").select("*").eq("record_type", type).is("archived_at", null).order("updated_at", { ascending: false }).limit(limit);
    // Historical meeting brands contain labels such as "자영업 교육"; filter them after normalization.
    if (brand && type !== "meeting") query = query.eq("brand", brand);
    if (team) query = query.eq("team", team);
    return query;
  };
  const [meetings, tasks, kpis] = await Promise.all([scoped("meeting", 500), scoped("task", 100), scoped("kpi", 20)]);
  const error = meetings.error || tasks.error || kpis.error;
  if (error) throw new ApiError(400, "MEETING_PREP_FAILED", "회의 준비 자료를 불러오지 못했습니다.", error.message);
  const wantedBusiness = brand ? resolveMeetingBusiness(brand)?.recordBrand ?? brand : "";
  const brandedMeetings = (meetings.data ?? []).filter(item => !wantedBusiness || (resolveMeetingBusiness(item.brand ?? "")?.recordBrand ?? item.brand) === wantedBusiness);
  const matchingMeetings = (brandedMeetings.length ? brandedMeetings : (meetings.data ?? []).filter(item => !item.brand))
    .sort((a,b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
  const latest = matchingMeetings.find(item => item.status === "done") ?? null;
  let pending = Array.isArray(latest?.metadata?.pending) ? latest.metadata.pending.map(String) : [];
  if (Array.isArray(latest?.metadata?.items)) pending = [...pending, ...latest.metadata.items.filter((item: {kind?:string;state?:string}) => item.kind === "open" && item.state !== "discarded").map((item: {text?:string}) => String(item.text ?? "")).filter(Boolean)];
  pending = [...new Set([...pending, ...matchingMeetings.filter(item => item.status === "review").flatMap(item => Array.isArray(item.metadata?.items) ? item.metadata.items.filter((candidate: {kind?:string;state?:string}) => candidate.kind === "decision" && candidate.state !== "discarded").map((candidate: {text?:string}) => String(candidate.text ?? "")).filter(Boolean) : [])])];
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
      // Shared with Telegram chats as well: never a restricted canonical summary.
      .eq("reader_scope", "all")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (doc?.content_md) {
      latestSummary = extractSection(doc.content_md, "핵심 요약");
      latestTitle = doc.title ?? latestTitle;
      latestDate = latestDate ?? doc.updated_at ?? null;
      if (!pending.length) pending = extractBulletList(doc.content_md, "미결사항");
    }
  }

  const openTodos = (tasks.data ?? []).filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 30);
  const completed = (tasks.data ?? []).filter(item => item.status === "done" && (!latestDate || item.updated_at >= latestDate)).slice(0, 20);
  const latestKpis = (kpis.data ?? []).slice(0, 12).map((item) => {
    const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata?.previousValue ?? 0);
    const signal = buildPerformanceSignal({ title: item.title, current, previous, target: Number(item.metric_target ?? 0) || null, unit: item.metric_unit });
    return { id: item.id, title: item.title, current, previous, unit: item.metric_unit, signal: signal.label };
  });
  const unreviewed = matchingMeetings.filter(item => item.status === "review").map(item => ({ id: item.id, title: item.title, date: item.starts_at ?? null }));
  return { latestMeeting: (latest || latestSummary) ? { id: latest?.id ?? "", title: latestTitle, date: latestDate, pending, summary: latestSummary } : null, pending, todos: openTodos, completed, kpis: latestKpis, unreviewed };
}
