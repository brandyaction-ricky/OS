import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { meetingBusinessOf, resolveMeetingBusiness } from "@/lib/meeting-business";
import { buildPerformanceSignal } from "@/lib/performance-signals";
import { KPI_BUSINESSES, formatKpiValue, kpiProgress, kstMonth } from "@/lib/kpi";
import { activeRuns } from "@/lib/kpi-runs";
import { eduRounds, monthRevenue } from "@/lib/server/kpi";

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
  /** Unfinished tasks that came out of this business's meetings of the last 60 days, newest meeting first. */
  followUps: Array<Record<string, unknown>>;
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
  const meetingBrand = (item: { brand?: string | null; title?: string | null }) => meetingBusinessOf(item.brand ?? "", item.title ?? "")?.recordBrand ?? item.brand ?? "";
  const brandedMeetings = (meetings.data ?? []).filter(item => !wantedBusiness || meetingBrand(item) === wantedBusiness);
  const matchingMeetings = (brandedMeetings.length ? brandedMeetings : (meetings.data ?? []).filter(item => !meetingBrand(item)))
    .sort((a,b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""));
  // The newest meeting that was held and has anything in it, finished or not: meetings left unclosed still count.
  // Requiring an AI summary made every new prep reuse the last summarised meeting (2026-11: 10-30's agenda came back on 11-02, 11-06 and 11-11).
  const held = (item: { status?: string; description?: string | null; metadata?: Record<string, unknown> | null }) => item.status !== "cancelled" && item.status !== "planned"
    && Boolean(item.metadata?.summary || item.metadata?.transcript || String(item.description ?? "").trim() || (Array.isArray(item.metadata?.items) && item.metadata.items.length));
  const latest = matchingMeetings.find(held) ?? null;
  let pending = Array.isArray(latest?.metadata?.pending) ? latest.metadata.pending.map(String) : [];
  if (Array.isArray(latest?.metadata?.items)) pending = [...pending, ...latest.metadata.items.filter((item: {kind?:string;state?:string}) => item.kind === "open" && item.state !== "discarded").map((item: {text?:string}) => String(item.text ?? "")).filter(Boolean)];
  // Only the last meeting's open questions. Decision candidates of unreviewed meetings are not open questions
  // (they read "~하기로 했다"); they stay listed under unreviewed for review instead (대표 2026-11-12).
  pending = [...new Set(pending)];
  // 체크할 할 일: tasks created from this business's meetings of the last 30 days that are not finished yet.
  // Only dated meetings count: imported old records carry a recent updated_at and brought back September tasks.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recentIds = matchingMeetings.filter(item => item.status !== "cancelled" && item.metadata?.workspace === "knowledge" && typeof item.starts_at === "string" && item.starts_at >= since).map(item => item.id);
  const followUpRead = recentIds.length ? await supabase.from("os_records").select("*").eq("record_type", "task").in("parent_id", recentIds).is("archived_at", null) : { data: [], error: null };
  if (followUpRead.error) throw new ApiError(400, "MEETING_PREP_FAILED", "회의 준비 자료를 불러오지 못했습니다.", followUpRead.error.message);
  const order = new Map(recentIds.map((id, index) => [id, index]));
  const followUps = (followUpRead.data ?? []).filter(item => recentIds.includes(item.parent_id) && !["done", "cancelled"].includes(item.status))
    .sort((a, b) => (order.get(a.parent_id) ?? 0) - (order.get(b.parent_id) ?? 0)).slice(0, 15);
  let latestSummary = typeof latest?.metadata?.summary === "string" && latest.metadata.summary ? latest.metadata.summary
    : typeof latest?.metadata?.transcript === "string" ? latest.metadata.transcript.slice(0, 800) : String(latest?.description ?? "").slice(0, 800);
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
      latestTitle = latest ? latestTitle : doc.title ?? latestTitle;
      latestDate = latestDate ?? doc.updated_at ?? null;
      if (!pending.length) pending = extractBulletList(doc.content_md, "미결사항");
    }
  }

  const openTodos = (tasks.data ?? []).filter((item) => !["done", "cancelled"].includes(item.status)).slice(0, 30);
  const completed = (tasks.data ?? []).filter(item => item.status === "done" && (!latestDate || item.updated_at >= latestDate)).slice(0, 20);
  // KPI-tab rows when the business has them: 마이인 this month, 브랜디에듀 its active sales rounds.
  // Each shows actual against target (revenue from the Toss ledger). Otherwise older KPI rows.
  const month = kstMonth(), today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const kpiBiz = KPI_BUSINESSES.find(item => item.brand === wantedBusiness);
  const cohorts = kpiBiz?.mode === "cohort" ? activeRuns(await eduRounds(), today).flatMap(round => round.settings ? [{ id: round.settings.id, name: round.label, net: round.net }] : []) : [];
  const tabRows = (kpis.data ?? []).filter(item => kpiBiz && item.metadata?.workspace === "kpi" && item.metadata?.business === kpiBiz.key
    && (kpiBiz.mode === "month" ? item.metadata?.periodMonth === month : cohorts.some(cohort => cohort.id === item.metadata?.cohortId)));
  const revenueOf = new Map<string, number>();
  for (const item of tabRows.filter(row => row.metadata?.metric === "revenue")) {
    const cohort = cohorts.find(entry => entry.id === item.metadata?.cohortId);
    revenueOf.set(item.id, cohort ? cohort.net : (await monthRevenue(month))[kpiBiz!.key].net);
  }
  const latestKpis = tabRows.length ? tabRows.map(item => {
    const current = item.metadata?.metric === "revenue" ? revenueOf.get(item.id) ?? 0 : Number(item.metric_current ?? 0), target = item.metric_target === null ? null : Number(item.metric_target);
    const progress = kpiProgress(current, target), cohort = cohorts.find(entry => entry.id === item.metadata?.cohortId);
    return { id: item.id, title: cohort ? `${cohort.name} · ${item.title}` : item.title, current, previous: 0, unit: item.metric_unit,
      signal: `${formatKpiValue(current, item.metric_unit)} / 목표 ${formatKpiValue(target, item.metric_unit)}${progress === null ? "" : ` (${progress}%)`}` };
  }) : (kpis.data ?? []).filter(item => item.metadata?.workspace !== "kpi").slice(0, 12).map((item) => {
    const current = Number(item.metric_current ?? 0); const previous = Number(item.metadata?.previousValue ?? 0);
    const signal = buildPerformanceSignal({ title: item.title, current, previous, target: Number(item.metric_target ?? 0) || null, unit: item.metric_unit });
    return { id: item.id, title: item.title, current, previous, unit: item.metric_unit, signal: `${formatKpiValue(current, item.metric_unit)} · ${signal.label}` };
  });
  const unreviewed = matchingMeetings.filter(item => item.status === "review").map(item => ({ id: item.id, title: item.title, date: item.starts_at ?? null }));
  return { latestMeeting: (latest || latestSummary) ? { id: latest?.id ?? "", title: latestTitle, date: latestDate, pending, summary: latestSummary } : null, pending, followUps, todos: openTodos, completed, kpis: latestKpis, unreviewed };
}
