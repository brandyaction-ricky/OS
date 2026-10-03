"use client";
import { ContentGenerationButton } from "./content-generation-button";
import { GENERATION_QUEUED_NOTICE, type GenerationMode } from "@/lib/content-generation-mode";

import {useQueryTab} from "./use-query-tab";
import { PageTitle } from "./page-title";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  Plus,
  Radar,
  Search,
  Sparkles,
  Star,
  Target,
  Users,
  X,
  Youtube,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, createRecord, generateContent, listAllRecordsOfType, listMembers, resolveYoutubeChannel, searchYoutubeMarket, updateRecord, type YoutubeChannelIdentity, type YoutubeMarketItem } from "@/lib/api-client";
import { structureBorrowInput } from "@/lib/structure-borrow";
import { discoveryResults, measureDiscovery } from "@/lib/discovery-results";
import { isNicheQueueRecord } from "@/lib/content-radar";
import { appealWorkflowState, approvedAppeals, normalizeAppealCandidates, researchBriefReady, type AppealDecision, type AppealResearchBrief } from "@/lib/content-appeals";
import { appealReadinessMissing } from "@/lib/content-appeal-readiness";
import { planningSelectionReady } from "@/lib/content-pipeline";
import type { OsRecord } from "@/lib/record-types";
import { contentOrigin } from "@/lib/content-origin";
import { summarizeContentSearchHistory } from "@/lib/content-search-history";
import { useSession } from "./session-provider";
import { ContentPlanningHandoff } from "./content-planning-handoff";
import { ContentTopicJevAssist } from "./content-topic-jev-assist";

type RadarTab = "channels" | "discovery" | "niches" | "planning";

const TABS: Array<{ key: RadarTab; label: string; hint: string }> = [
  { key: "channels", label: "채널", hint: "관찰 채널 수집" },
  { key: "discovery", label: "탐색", hint: "터진 영상 발굴" },
  { key: "niches", label: "틈새", hint: "주제 확정" },
  { key: "planning", label: "기획", hint: "확정 주제" },
];

const ENTRY_CATEGORIES = [
  ["A", "강점·재능", "잘하는 것, 재능, 강점 찾기"],
  ["B", "성향·기질", "성격, 기질, 나다운 방식"],
  ["C", "직업·커리어", "이직, 직무, 커리어 선택"],
  ["D", "사업·창업", "1인 사업, 창업, 수익화"],
  ["E", "생산성", "실행력, 습관, 시간 관리"],
  ["F", "관계·소통", "대인관계, 갈등, 말하기"],
  ["G", "마음·감정", "불안, 자존감, 회복"],
  ["H", "돈·경제", "재테크, 소비, 경제적 자유"],
  ["I", "공부·성장", "학습법, 독서, 성장"],
  ["J", "건강·생활", "수면, 운동, 루틴"],
  ["K", "리더십", "조직, 관리, 리더의 판단"],
  ["L", "라이프 전환", "퇴사, 전환기, 인생 설계"],
] as const;

function meta<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const found = record?.metadata?.[key];
  return found == null ? fallback : found as T;
}

function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ContentRadarWorkspace({ showPlanningHandoff = false, showTopicJevAssist = false, lockedSource, productionMode=false }: { showPlanningHandoff?: boolean; showTopicJevAssist?: boolean; lockedSource?:OsRecord; productionMode?:boolean } = {}) {
  const { accessToken, demo, profile } = useSession();
  const [allRecords, setRecords] = useState<OsRecord[]>(lockedSource?[lockedSource]:[]);
  const [includeTests, setIncludeTests] = useState(false);
  const records = useMemo(() => allRecords.filter(record => includeTests || contentOrigin(record) !== "test"), [allRecords, includeTests]);
  const [packages, setPackages] = useState<OsRecord[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [queryTab, setTab] = useQueryTab<RadarTab>("tab",["channels","discovery","niches","planning"],"channels");
  const tab=productionMode?"planning":queryTab;
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [resultQuery, setResultQuery] = useState("");
  const searchInFlight = useRef(false);
  const [results, setResults] = useState<YoutubeMarketItem[]>([]);
  const [durationFilter, setDurationFilter] = useState("long");
  const [daysFilter, setDaysFilter] = useState("all");
  const [resultSort, setResultSort] = useState("ratio");
  const [outliersOnly, setOutliersOnly] = useState(true);
  const [region, setRegion] = useState("KR");
  const [resultRegion, setResultRegion] = useState("KR");
  const [notice, setNotice] = useState("");
  const [borrowItem, setBorrowItem] = useState<YoutubeMarketItem | null>(null);
  const [singleCard, setSingleCard] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [checkedVideos, setCheckedVideos] = useState<Set<string>>(new Set());
  const [baselines, setBaselines] = useState<Record<string, { state: string; sampleCount: number; ratio: number | null; robustZ: number | null; outlier: boolean; reason: string }>>({});
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [verifiedChannel, setVerifiedChannel] = useState<YoutubeChannelIdentity | null>(null);
  const [topicOpen, setTopicOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [appealNote, setAppealNote] = useState("");
  const [selectedAppeals, setSelectedAppeals] = useState<Set<number>>(new Set());
  const [appealCanApprove, setAppealCanApprove] = useState(false);
  const [appealApprovalLoaded, setAppealApprovalLoaded] = useState(false);
  const [appealAssignments, setAppealAssignments] = useState<Array<{ user_id: string; kind: string }>>([]);
  const [appealComments, setAppealComments] = useState<Array<{ id: string; candidate_index: number; body: string; author_id: string; created_at: string }>>([]);
  const [appealCommentIndex, setAppealCommentIndex] = useState<number | null>(null);
  const [appealCommentBody, setAppealCommentBody] = useState("");
  const [appealCommentError, setAppealCommentError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [topicResult, packageResult, memberResult] = await Promise.all([
        listAllRecordsOfType(accessToken, "content_topic"),
        listAllRecordsOfType(accessToken, "content_package"),
        listMembers(accessToken).catch(() => null),
      ]);
      setRecords(topicResult);
      setPackages(packageResult);
      if (memberResult) setMemberNames(Object.fromEntries(memberResult.members.map(member => [member.id, member.display_name])));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "콘텐츠 탐색 자료를 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const channels = useMemo(() => records.filter((record) => meta<string>(record, "studioKind", "") === "channel"), [records]);
  const outliers = useMemo(() => records.filter((record) => meta<string>(record, "studioKind", "") === "outlier"), [records]);
  const trackedOutliers = useMemo(() => outliers.filter((record) => meta<string>(record, "discoverySource", "") === "tracked_channel"), [outliers]);
  const risingSignals = useMemo(() => outliers.filter((record) => meta<string>(record, "discoverySource", "") === "rising_channel"), [outliers]);
  const topics = useMemo(() => records.filter((record) => {
    const kind = meta<string>(record, "studioKind", "");
    return !["channel", "outlier"].includes(kind) && record.metadata?.automationSource !== true;
  }), [records]);
  const nicheQueue = useMemo(() => records.filter(isNicheQueueRecord), [records]);
  const nicheTopics = useMemo(() => nicheQueue.filter((topic) => topic.status !== "planned"), [nicheQueue]);
  const plannedTopics = useMemo(() => nicheQueue.filter((topic) => topic.status === "planned"), [nicheQueue]);
  const plans = useMemo(() => packages.filter((record) => meta<string>(record, "packageKind", "") === "topic_plan"), [packages]);
  const appealSets = useMemo(() => packages
    .filter((record) => meta<string>(record, "packageKind", "") === "appeal_candidates")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()), [packages]);
  const searches = useMemo(() => packages.filter((record) => meta<string>(record, "packageKind", "") === "search_history"), [packages]);
  const searchSummaries = useMemo(() => summarizeContentSearchHistory(searches), [searches]);
  const visibleTopics = lockedSource ? records.filter(row=>row.id===lockedSource.id) : tab === "planning" ? plannedTopics : tab === "niches" ? nicheTopics : topics;
  const selected = visibleTopics.find((topic) => topic.id === selectedId) ?? visibleTopics[0] ?? null;
  const plan = plans.filter((record) => record.parent_id === selected?.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
  const appealSet = appealSets.find((record) => record.parent_id === selected?.id) ?? null;
  useEffect(() => { setSelectedAppeals(new Set()); setAppealNote(""); }, [appealSet?.id, appealSet?.version, selected?.id]);
  useEffect(() => {
    if (!appealSet || demo) { setAppealComments([]); return; }
    let active = true;
    setAppealCommentIndex(null); setAppealCommentError("");
    apiRequest<{ comments: typeof appealComments }>(`/api/v1/content/appeals/comments?packageId=${encodeURIComponent(appealSet.id)}`, { token: accessToken })
      .then((result) => { if (active) setAppealComments(result.comments); })
      .catch(() => { if (active) { setAppealComments([]); setAppealCommentError("댓글을 불러오지 못했습니다. 개발 DB의 댓글 기능 적용 상태를 확인해 주세요."); } });
    return () => { active = false; };
  }, [appealSet, accessToken, demo]);
  useEffect(() => {
    if (!appealSet) { setAppealCanApprove(false); setAppealApprovalLoaded(true); setAppealAssignments([]); return; }
    if (demo) {
      setAppealCanApprove(profile?.role === "admin" && appealSet.created_by !== profile?.id);
      setAppealApprovalLoaded(true);
      return;
    }
    let cancelled = false;
    setAppealApprovalLoaded(false);
    apiRequest<{ canApprove: boolean; assignments: Array<{ user_id: string; kind: string }> }>(
      `/api/v1/approvals?recordId=${encodeURIComponent(appealSet.id)}`, { token: accessToken })
      .then((result) => { if (!cancelled) { setAppealCanApprove(result.canApprove); setAppealAssignments(result.assignments); } })
      .catch(() => { if (!cancelled) { setAppealCanApprove(false); setAppealAssignments([]); } })
      .finally(() => { if (!cancelled) setAppealApprovalLoaded(true); });
    return () => { cancelled = true; };
  }, [appealSet, accessToken, demo, profile?.id, profile?.role]);
  const planResult = meta<Record<string, unknown>>(plan, "result", {});
  const candidates = Array.isArray(planResult.candidates) ? planResult.candidates as Array<Record<string, unknown>> : [];
  const planningReady = Boolean(selected && planningSelectionReady(selected, plan));
  const appealResult = meta<Record<string, unknown>>(appealSet, "result", {});
  const appealCandidates = normalizeAppealCandidates(appealResult.candidates);
  const approvedAppealItems = approvedAppeals(appealCandidates);
  const researchBrief = meta<Record<string, unknown>>(selected, "researchBrief", {});
  const researchMatchesAppeals = Boolean(appealSet
    && researchBrief.appealPackageId === appealSet.id
    && Number(researchBrief.appealPackageVersion) === appealSet.version);
  const researchReady = researchMatchesAppeals && researchBriefReady(researchBrief);
  const workflowState = appealWorkflowState(appealCandidates, researchReady);
  const readinessMissing = appealReadinessMissing(selected);

  useEffect(() => {
    if ((tab === "niches" || tab === "planning") && !visibleTopics.some((topic) => topic.id === selectedId)) {
      setSelectedId(visibleTopics[0]?.id ?? "");
    } else if (!selectedId && topics[0]) {
      setSelectedId(topics[0].id);
    }
  }, [selectedId, tab, topics, visibleTopics]);

  const addChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verifiedChannel) return setError("채널 주소를 먼저 확인해 주세요.");
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await createRecord(accessToken, {
        recordType: "content_topic",
        title: verifiedChannel.title,
        description: formText(form, "reason"),
        status: "active",
        priority: "normal",
        stage: "관찰 채널",
        brand: "브랜디액션",
        team: profile?.team || "콘텐츠",
        sourceUrl: verifiedChannel.url,
        tags: ["관찰채널", formText(form, "category")].filter(Boolean),
        metadata: {
          studioKind: "channel",
          category: formText(form, "category"),
          ownerGroup: formText(form, "ownerGroup"),
          defaultFormat: formText(form, "format"),
          region: "KR",
          evidence: formText(form, "reason"),
          channelId: verifiedChannel.id,
          handle: verifiedChannel.handle,
          thumbnail: verifiedChannel.thumbnail,
          subscribers: verifiedChannel.subscribers,
          videoCount: verifiedChannel.videos,
          totalViews: verifiedChannel.views,
          verifiedAt: new Date().toISOString(),
        },
      });
      setChannelOpen(false); setChannelInput(""); setVerifiedChannel(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관찰 채널을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const verifyChannel = async () => {
    if (channelInput.trim().length < 2) return setError("YouTube 채널 URL이나 @핸들을 입력해 주세요.");
    setBusy(true); setError(""); setVerifiedChannel(null);
    try {
      setVerifiedChannel((await resolveYoutubeChannel(accessToken, channelInput.trim())).channel);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "채널 정보를 확인하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const runSearch = async () => {
    if (searchInFlight.current || busy) return;
    const query = searchQuery.trim();
    if (query.length < 2) return setError("탐색 키워드를 두 글자 이상 입력해 주세요.");
    searchInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await searchYoutubeMarket(accessToken, query, 20, { region, order: resultSort === "recent" ? "date" : "viewCount" });
      setResults(response.items); setResultQuery(query); setCardIndex(0); setCheckedVideos(new Set()); setResultRegion(region); setBaselines({}); setNotice("같은 채널의 비교 표본을 확인하고 있습니다…");
      const comparison = await measureDiscovery(response.items, (item) => apiRequest(`/api/v1/youtube/outlier?videoId=${encodeURIComponent(item.id)}`, { token: accessToken }), (id, result) => setBaselines((current) => ({ ...current, [id]: result })));
      setNotice(`비교 ${comparison.attempted}개 중 ${comparison.attempted - comparison.failed}개 처리 · ${comparison.failed}개 실패. 표본 부족은 별도로 표시됩니다. 현재 누적 조회 기준으로, 고정 연령·세부 포맷은 추가 검토가 필요합니다.`);
      await createRecord(accessToken, {
        recordType: "content_package",
        title: `${query} 탐색`,
        description: `YouTube 시장 영상 ${response.items.length}개 탐색`,
        status: "done",
        priority: "normal",
        stage: "시장 탐색",
        team: profile?.team || "콘텐츠",
        tags: ["탐색이력", query],
        metadata: {
          packageKind: "search_history",
          query,
          resultCount: response.items.length,
          topViewCount: response.items[0]?.viewCount ?? 0,
          searchedAt: new Date().toISOString(),
        },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "시장 탐색을 완료하지 못했습니다.");
    } finally { searchInFlight.current = false; setBusy(false); }
  };

  const measureBaseline = async (item: YoutubeMarketItem) => {
    setBusy(true); setError("");
    try { const result = await apiRequest<(typeof baselines)[string]>(`/api/v1/youtube/outlier?videoId=${encodeURIComponent(item.id)}`, { token: accessToken }); setBaselines((current) => ({ ...current, [item.id]: result })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "동일 채널 기준선을 계산하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const decisions = new Map(packages.filter((record) => meta<string>(record, "packageKind", "") === "discovery_decision").slice().reverse().map((record) => [meta(record, "youtubeId", ""), record]));
  const visibleResults = discoveryResults(results, baselines, { format: durationFilter, days: daysFilter, sort: resultSort, outliersOnly }).filter((item) => showDiscarded || decisions.get(item.id)?.status !== "blocked");
  if (resultSort === "fit") visibleResults.sort((a, b) => Number(decisions.get(b.id)?.metadata.fitScore ?? 0) - Number(decisions.get(a.id)?.metadata.fitScore ?? 0));
  const visibleCards = singleCard ? visibleResults.slice(Math.min(cardIndex, Math.max(0, visibleResults.length - 1)), Math.min(cardIndex, Math.max(0, visibleResults.length - 1)) + 1) : visibleResults;
  const saveOutlier = async (item: YoutubeMarketItem, navigate = true, manageBusy = true) => {
    if (outliers.some((record) => meta(record, "youtubeId", "") === item.id)) return;
    if (manageBusy) { setBusy(true); setError(""); }
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "content_topic",
        title: item.title,
        description: `${item.channelTitle}에서 발견한 시장 근거 영상`,
        status: "review",
        priority: "high",
        stage: "아웃라이어 근거",
        team: profile?.team || "콘텐츠",
        sourceUrl: item.url,
        metricCurrent: item.viewCount,
        metricUnit: "조회",
        tags: ["아웃라이어", resultQuery].filter(Boolean),
        metadata: {
          studioKind: "outlier", baseline: baselines[item.id] ?? null, discoverySource: "keyword",
          youtubeId: item.id,
          channelTitle: item.channelTitle,
          thumbnail: item.thumbnail,
          publishedAt: item.publishedAt,
          views: item.viewCount,
          likes: item.likeCount,
          comments: item.commentCount,
          query: resultQuery,
        },
      });
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      if (navigate) { setSelectedId(record.id); setTab("niches"); setNotice("틈새 근거로 저장했습니다. 저장한 영상을 선택했습니다."); }
      return record;
    } catch (reason) {
      if (!manageBusy) throw reason;
      setError(reason instanceof Error ? reason.message : "근거 영상을 저장하지 못했습니다.");
    } finally { if (manageBusy) setBusy(false); }
  };

  const reviewVideo = async (item: YoutubeMarketItem, status: "review" | "blocked", fitScore = 0) => {
    setBusy(true); setError("");
    try {
      const existing = decisions.get(item.id);
      const metadata = { ...(existing?.metadata ?? {}), packageKind: "discovery_decision", youtubeId: item.id, fitScore, reviewedAt: new Date().toISOString() };
      const response = existing ? await updateRecord(accessToken, { id: existing.id, expectedVersion: existing.version, status, metadata })
        : await createRecord(accessToken, { recordType: "content_package", title: item.title, status, priority: "normal", sourceUrl: item.url, team: profile?.team || "콘텐츠", metadata });
      setPackages((current) => [response.record, ...current.filter((record) => record.id !== response.record.id)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "영상 검토 상태를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const borrow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!borrowItem) return;
    const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, structureBorrowInput(borrowItem, formText(form, "topic"), formText(form, "fulfillment"), profile?.team || "콘텐츠"));
      setRecords((current) => [record, ...current]); setSelectedId(record.id); setTab("niches"); setBorrowItem(null);
      setNotice("구조 차용 후보를 저장했습니다. 후보 뽑기 후 원본 구조와 우리 약속을 검토하고 채택해 주세요.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "구조 차용 후보를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const bulkSave = async () => {
    const items = visibleResults.filter((item) => checkedVideos.has(item.id) && item.durationSeconds >= 240 && !outliers.some((record) => meta(record, "youtubeId", "") === item.id));
    if (!items.length) return;
    setBusy(true); setError("");
    const outcomes = await Promise.allSettled(items.map((item) => saveOutlier(item, false, false)));
    const successful = new Set(items.filter((_, index) => outcomes[index].status === "fulfilled").map((item) => item.id));
    setCheckedVideos((current) => new Set([...current].filter((id) => !successful.has(id))));
    setNotice(`근거 ${successful.size}개 저장 · ${items.length - successful.size}개 실패. 실패한 선택은 다시 시도할 수 있게 남겼습니다.`); setBusy(false);
  };

  const addTopic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "content_topic",
        title: formText(form, "title"),
        description: formText(form, "problem"),
        status: "backlog",
        priority: "high",
        brand: formText(form, "brand"),
        team: profile?.team || "콘텐츠",
        sourceUrl: formText(form, "sourceUrl") || null,
        tags: formText(form, "keywords").split(",").map((item) => item.trim()).filter(Boolean),
        metadata: {
          studioKind: "niche",
          audience: formText(form, "audience"),
          entryLanguage: formText(form, "entryLanguage"),
          hierarchy: formText(form, "hierarchy"),
          sourceChannel: formText(form, "channel"),
          evidence: formText(form, "evidence"),
        },
      });
      setTopicOpen(false); setSelectedId(record.id); setTab("niches");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "틈새 후보를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const saveReadiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const evidence = formText(form, "evidence");
    if (evidence) {
      try { const url = new URL(evidence); if (!["http:", "https:"].includes(url.protocol)) throw Error(); }
      catch { setError("시장 근거에는 탐색에서 연결한 영상 주소를 입력해 주세요."); return; }
    }
    setBusy(true); setError("");
    try {
      const { record } = await updateRecord(accessToken, {
        id: selected.id, expectedVersion: selected.version, sourceUrl: evidence || null,
        metadata: { ...selected.metadata,
          audience: formText(form, "audience"), entryLanguage: formText(form, "entryLanguage"),
          hierarchy: formText(form, "hierarchy"), evidence,
        },
      });
      setRecords((current) => current.map((item) => item.id === record.id ? record : item));
      setNotice("기획 준비도를 저장했습니다. 네 칸을 채우면 승인 요청을 보낼 수 있습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "기획 준비도를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const makePlan = async (mode: GenerationMode = "queue") => {
    if (!selected) return;
    if (!researchReady) return setError("승인된 소구점의 레퍼런스 검증을 먼저 완료해 주세요.");
    setBusy(true); setError("");
    try {
      const response = await generateContent(accessToken, { mode, action: "topic_plan", sourceId: selected.id });
      if (response.queued) setError(GENERATION_QUEUED_NOTICE);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기획 후보를 만들지 못했습니다.");
    } finally { setBusy(false); }
  };

  const makeAppeals = async (mode: GenerationMode = "queue") => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await generateContent(accessToken, { mode, action: "appeal_candidates", sourceId: selected.id, count: 10 });
      if (response.queued) setError(GENERATION_QUEUED_NOTICE);
      else setNotice("설명과 레퍼런스 없이 소구점 후보 10개를 만들었습니다. 진행할 후보를 사람이 승인해 주세요.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "소구점 후보를 만들지 못했습니다.");
    } finally { setBusy(false); }
  };

  const decideAppeals = async (indices: number[], decision: AppealDecision) => {
    if (!appealSet || !indices.length) return;
    if (!appealCanApprove) return setError("작성자와 승인자를 분리해야 합니다. 회사 설정의 승인자 또는 위임자에게 요청해 주세요.");
    if (decision === "revision" && !appealNote.trim()) return setError("수정 요청 사유를 적어 주세요.");
    setBusy(true); setError(""); setNotice("");
    try {
      const { record } = await apiRequest<{ record: OsRecord }>("/api/v1/content/appeals/decide", {
        method: "POST", token: accessToken, body: JSON.stringify({
        id: appealSet.id,
        expectedVersion: appealSet.version,
        candidateSetVersion: String(appealSet.metadata?.candidateSetVersion ?? ""),
        entries: indices.map((index) => ({ index, decision, note: appealNote.trim() })),
        }),
      });
      setPackages((current) => current.map((item) => item.id === record.id ? record : item));
      setAppealNote(""); setSelectedAppeals(new Set());
      setNotice(`소구점 ${indices.length}개 판정을 저장했습니다. 승인 구성이 바뀌면 레퍼런스를 다시 검증해야 합니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "소구점 판정을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const requestAppealApproval = async () => {
    if (!appealSet || !selected) return;
    if (readinessMissing.length) return setError(`승인 요청 전에 채워 주세요: ${readinessMissing.join(" · ")}`);
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await apiRequest<{ requested: boolean; recipientCount: number }>("/api/v1/content/appeals/request", {
        method: "POST", token: accessToken,
        body: JSON.stringify({ packageId: appealSet.id, expectedVersion: appealSet.version }),
      });
      setNotice(`승인자·위임자 ${result.recipientCount}명에게 알림을 보냈습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "승인 요청을 보내지 못했습니다."); }
    finally { setBusy(false); }
  };

  const addAppealComment = async () => {
    if (!appealSet || appealCommentIndex === null || !appealCommentBody.trim()) return;
    setBusy(true); setAppealCommentError("");
    try {
      if (demo) throw new Error("데모에서는 댓글을 저장하지 않습니다.");
      const result = await apiRequest<{ comment: (typeof appealComments)[number] }>("/api/v1/content/appeals/comments", {
        method: "POST", token: accessToken,
        body: JSON.stringify({ packageId: appealSet.id, expectedVersion: appealSet.version,
          candidateSetVersion: String(appealSet.metadata?.candidateSetVersion ?? ""),
          index: appealCommentIndex, body: appealCommentBody.trim() }),
      });
      setAppealComments((current) => [...current, result.comment]); setAppealCommentBody("");
    } catch (reason) { setAppealCommentError(reason instanceof Error ? reason.message : "댓글을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const decideTopic = async (status: "planned" | "review" | "blocked") => {
    if (!selected) return;
    if (status === "planned" && !researchReady) return setError("승인된 소구점과 레퍼런스 검증을 완료한 뒤 기획으로 넘길 수 있습니다.");
    setBusy(true); setError("");
    try {
      const { record } = await updateRecord(accessToken, {
        id: selected.id,
        expectedVersion: selected.version,
        status,
        stage: status === "planned" ? "기획으로 넘기기" : status === "blocked" ? "보류" : "더 지켜보기",
        metadata: { ...selected.metadata, decidedAt: new Date().toISOString() },
      });
      setRecords((current) => current.map((item) => item.id === record.id ? record : item));
      if (status === "planned") {
        setSelectedId(record.id);
        setTab("planning");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "틈새 판정을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const pickCandidate = async (index: number) => {
    if (!selected || !plan) return;
    const next = candidates.map((candidate, itemIndex) => ({ ...candidate, picked: itemIndex === index }));
    setBusy(true); setError("");
    try {
      const selectedAt = new Date().toISOString();
      const { record: updatedPlan } = await updateRecord(accessToken, { id: plan.id, expectedVersion: plan.version, metadata: { ...plan.metadata, result: { ...planResult, candidates: next } } });
      const { record: updatedSource } = await updateRecord(accessToken, {
        id: selected.id,
        expectedVersion: selected.version,
        status: "planned",
        stage: "패키징 준비",
        metadata: {
          ...selected.metadata,
          pipelineEnabled: true,
          pickedCandidate: next[index],
          planningPackageId: updatedPlan.id,
          planningPackageVersion: updatedPlan.version,
          planningSelectedAt: selectedAt,
          handoff: String(planResult.handoff ?? ""),
          decidedAt: selectedAt,
        },
      });
      setRecords((current) => current.map((item) => item.id === updatedSource.id ? updatedSource : item));
      setPackages((current) => current.map((item) => item.id === updatedPlan.id ? updatedPlan : item));
      setNotice("기획 방향을 채택했습니다. 같은 content_id로 기획·근거를 승인한 뒤 제목·썸네일에서 이어가세요.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "후보 채택을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const saveResearchBrief = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !appealSet || !approvedAppealItems.length) return setError("먼저 진행할 소구점을 한 개 이상 승인해 주세요.");
    const form = new FormData(event.currentTarget);
    const youtubeUrls = formText(form, "youtubeSources").split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 10);
    const instagramUrls = formText(form, "instagramSources").split("\n").map((value) => value.trim()).filter(Boolean).slice(0, 10);
    const sourceUrls = [...youtubeUrls, ...instagramUrls];
    const nextBrief: AppealResearchBrief & Record<string, unknown> = {
      sourceUrls,
      youtubeUrls,
      instagramUrls,
      topicFit: formText(form, "topicFit"),
      audienceFit: formText(form, "audienceFit"),
      queryIntentFit: formText(form, "queryIntentFit"),
      verifiedMetrics: formText(form, "verifiedMetrics"),
      limitations: formText(form, "limitations"),
      analystNotes: formText(form, "analystNotes"),
      brandContext: formText(form, "brandContext"),
      verifiedAt: new Date().toISOString(),
      appealPackageId: appealSet.id,
      appealPackageVersion: appealSet.version,
      approvedAppeals: approvedAppealItems.map((item) => ({ text: item.text, decidedAt: item.decidedAt ?? null })),
    };
    setBusy(true); setError("");
    try {
      const { record } = await updateRecord(accessToken, {
        id: selected.id,
        expectedVersion: selected.version,
        metadata: {
          ...selected.metadata,
          researchBrief: nextBrief,
        },
      });
      setRecords((current) => current.map((item) => item.id === record.id ? record : item));
      setNotice(researchBriefReady(nextBrief) ? "레퍼런스 검증을 완료했습니다. 이제 기획안을 만들 수 있습니다." : "리서치 초안을 저장했습니다. URL·세 가지 적합성·검증 한계를 모두 채우면 다음 단계가 열립니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "리서치 메모를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  return <>
    <label className="content-origin-filter"><input type="checkbox" checked={includeTests} onChange={event => setIncludeTests(event.target.checked)} /> 테스트 데이터 포함</label>
    <header className="page-header">
      <div className="page-title-group"><PageTitle /><p>채널을 모으고 터진 영상을 발굴한 뒤, 반복 근거가 있는 틈새만 제작 기획으로 넘깁니다.</p></div>
      <div className="header-actions">
        {tab === "channels" ? <button className="primary-button" onClick={() => setChannelOpen(true)}><Plus size={15} /> 채널 추가</button> : null}
        {tab === "niches" ? <button className="primary-button" onClick={() => setTopicOpen(true)}><Plus size={15} /> 틈새 후보 추가</button> : null}
      </div>
    </header>
    {error ? <div className={`inline-alert ${error === GENERATION_QUEUED_NOTICE ? "success" : "danger"}`}><CircleAlert size={16} /> {error}</div> : null}
    {!productionMode ? <nav className="studio-tabs content-radar-tabs" aria-label="주제 탐색 단계">
      {TABS.filter(item=>item.key!=="planning").map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}
    <Link href="/content/production?view=tools&step=planning">제작 기획으로</Link></nav> : null}

    {tab === "channels" ? <>
      <section className="metric-grid compact-metrics">
        <div className="metric-card"><div className="metric-top"><span>매일 보는 채널</span><Users size={16} /></div><div className="metric-value">{channels.length}</div><div className="metric-caption">승인된 관찰 채널</div></div>
        <div className="metric-card"><div className="metric-top"><span>모은 영상</span><Youtube size={16} /></div><div className="metric-value">{outliers.length}</div><div className="metric-caption">OS에 저장한 근거 영상</div></div>
        <div className="metric-card"><div className="metric-top"><span>발견 근거</span><Radar size={16} /></div><div className="metric-value">{outliers.length}</div><div className="metric-caption">저장한 시장 영상</div></div>
        <div className="metric-card"><div className="metric-top"><span>기획 확정</span><Check size={16} /></div><div className="metric-value">{topics.filter((topic) => topic.status === "planned").length}</div><div className="metric-caption good">원고 공정 전달 가능</div></div>
      </section>
      <section className="panel channel-dictionary">
        <div className="panel-header"><div><h2>채널 탐색 사전</h2><p>A–L 사람들이 찾는 말로 시장을 넓히되, 채널 승인에는 반복 근거를 남깁니다.</p></div><span>{ENTRY_CATEGORIES.length}개 분류</span></div>
        <div>{ENTRY_CATEGORIES.map(([letter, name, description]) => <button type="button" key={letter} onClick={() => { setSearchQuery(description.split(",")[0].trim()); setTab("discovery"); }}><b>{letter}</b><span><strong>{name}</strong><small>{description}</small></span></button>)}</div>
      </section>
      <section className="panel content-data-table">
        <div className="panel-header"><div><h2>매일 보는 채널</h2><p>채널 URL·운영하는 곳·대표 형식을 함께 관리합니다.</p></div><button className="ghost-button" onClick={() => setChannelOpen(true)}><Plus size={14} /> 직접 추가</button></div>
        <div className="content-table-head"><span>채널</span><span>분류</span><span>운영하는 곳</span><span>기본 형식</span><span>상태</span><span /></div>
        {channels.map((channel) => <div className="content-table-row" key={channel.id}><span><strong>{channel.title}</strong><small>{channel.description || "승인 근거 미입력"}</small></span><span>{meta(channel, "category", "미분류")}</span><span>{meta(channel, "ownerGroup", "미입력")}</span><span>{meta(channel, "defaultFormat", "해설")}</span><span className="status-pill status-active">추적 중</span><span>{channel.source_url ? <a href={channel.source_url} target="_blank" rel="noreferrer" aria-label={`${channel.title} 열기`}><ExternalLink size={14} /></a> : null}</span></div>)}
        {!channels.length ? <div className="compact-empty"><Youtube size={24} /><strong>아직 매일 보는 채널이 없습니다.</strong><span>캡처의 채널 사전 기준으로 첫 관찰 채널을 등록하세요.</span></div> : null}
      </section>
    </> : null}

    {tab === "discovery" ? <>
      <section className="panel discovery-console">
        <div><span className="eyebrow">YouTube Data API</span><h2>터진 영상 발굴</h2><p>키워드별 조회 상위 영상을 불러오고, 사람이 근거 영상을 골라 틈새 판정에 보냅니다.</p></div>
        <div className="market-search"><Search size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} placeholder="예: 직장인 강점 찾기, 퇴사 후 불안" /><button className="primary-button" disabled={busy} onClick={runSearch}>{busy ? "탐색 중…" : "영상 탐색"}</button></div>
        <div className="radar-filters"><label>길이<select value={durationFilter} onChange={(event) => setDurationFilter(event.target.value)}><option value="long">롱폼 · 4분 이상</option><option value="short">4분 미만 · 참고만</option></select></label><label>발행 기간<select value={daysFilter} onChange={(event) => setDaysFilter(event.target.value)}><option value="all">전체</option><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="365">최근 1년</option></select></label><label>정렬<select value={resultSort} onChange={(event) => setResultSort(event.target.value)}><option value="views">조회순</option><option value="recent">최신순</option><option value="ratio">채널 중앙값 배율순</option><option value="fit">팀 검토 적합도순</option></select></label><label>검색 지역<select value={region} disabled={busy} onChange={(event) => setRegion(event.target.value)}><option value="KR">한국</option><option value="US">미국</option><option value="JP">일본</option><option value="all">전체</option></select></label><label><input type="checkbox" checked={outliersOnly} disabled={durationFilter === "short"} onChange={(event) => setOutliersOnly(event.target.checked)} /> 비교 기준을 넘은 후보만</label><small>표시 {visibleResults.length}/{results.length} · 결과 지역 {resultRegion} · 지역 변경은 다음 검색에 적용</small></div>
      </section>
      <section className="panel content-data-table">
        <div className="panel-header"><div><h2>추적 채널 자동 발견</h2><p>시간별 스냅숏의 조기 상승 신호와 회사 아웃라이어 정본을 함께 표시합니다.</p></div><span>{trackedOutliers.length + risingSignals.length}개</span></div>
        <div className="content-table-head"><span>영상</span><span>채널</span><span>조회</span><span>비교 기준</span></div>
        {[...risingSignals, ...trackedOutliers].slice(0, 12).map((record) => { const rising = meta<string>(record, "discoverySource", "") === "rising_channel"; return <a className="content-table-row" href={record.source_url || "#"} target="_blank" rel="noreferrer" key={record.id}><span><strong>{record.title}</strong><small>{new Date(meta(record, "observedAt", record.created_at)).toLocaleString("ko-KR")}</small></span><span>{meta(record, "channelTitle", "채널 미입력")}</span><span>{Number(meta(record, "views", record.metric_current ?? 0)).toLocaleString("ko-KR")}</span><span>{rising ? `조기 상승 · ${Number(meta<Record<string, unknown>>(record, "momentum", {}).velocity ?? 0).toFixed(0)}/h` : `${Number(meta<Record<string, unknown>>(record, "baseline", {}).ratio ?? 0).toFixed(2)}배`}</span></a>; })}
        {!trackedOutliers.length && !risingSignals.length ? <div className="list-empty">세 번의 시간별 수집 뒤 조기 상승 후보가, 표본 20개 충족 뒤 정본 아웃라이어가 표시됩니다.</div> : null}
      </section>
      {notice ? <p className="inline-alert" role="status">{notice}</p> : null}
      {results.length > 0 && visibleResults.length === 0 ? <p className="list-empty">현재 기준을 넘은 영상이 없습니다. “후보만”을 해제하면 표본 부족·일반 범위의 비교 결과도 볼 수 있습니다.</p> : null}
      {results.length ? <div className="radar-filters"><label><input type="checkbox" checked={singleCard} onChange={(event) => { setSingleCard(event.target.checked); setCardIndex(0); }} /> 빠른 넘기기</label><label><input type="checkbox" checked={showDiscarded} onChange={(event) => setShowDiscarded(event.target.checked)} /> 검토 제외도 보기</label><button className="secondary-button" disabled={busy || !checkedVideos.size || durationFilter === "short"} onClick={() => void bulkSave()}>선택 근거 저장 ({checkedVideos.size})</button>{singleCard ? <><button disabled={cardIndex <= 0} onClick={() => setCardIndex((index) => Math.max(0, index - 1))}>이전</button><span>{visibleResults.length ? Math.min(cardIndex + 1, visibleResults.length) : 0} / {visibleResults.length}</span><button disabled={cardIndex >= visibleResults.length - 1} onClick={() => setCardIndex((index) => index + 1)}>다음</button></> : null}<small>폭넓게 모으려면 “비교 기준을 넘은 후보만”을 해제하세요. 적합도는 AI 추정이 아닌 팀이 지정한 값입니다.</small></div> : null}
      {results.length ? <section className="outlier-result-grid">{visibleCards.map((item) => {
        const saved = outliers.some((record) => meta(record, "youtubeId", "") === item.id);
        const engagement = item.viewCount ? (item.likeCount + item.commentCount) / item.viewCount * 100 : 0;
        return <article className="panel outlier-result" key={item.id}><label><input type="checkbox" checked={checkedVideos.has(item.id)} disabled={busy || saved || durationFilter === "short"} onChange={(event) => setCheckedVideos((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /> 근거 선택</label><a href={item.url} target="_blank" rel="noreferrer"><span className="outlier-thumb" style={{ backgroundImage: `url(${item.thumbnail})` }}><i><Eye size={13} /> {compactNumber(item.viewCount)}</i></span></a><div><small>{item.channelTitle}</small><h3>{item.title}</h3><div><span>조회 {item.viewCount.toLocaleString("ko-KR")}</span><span>반응 {engagement.toFixed(1)}%</span></div>{baselines[item.id] ? <p className="baseline-result">{baselines[item.id].ratio === null ? `비교 표본 ${baselines[item.id].sampleCount}/20` : `중앙값 ${baselines[item.id].ratio!.toFixed(2)}배 · ${baselines[item.id].outlier ? "이상치 후보" : "일반 범위"}`}<small>{baselines[item.id].reason}</small></p> : null}<button className="secondary-button" disabled={busy} onClick={() => measureBaseline(item)}>같은 채널 20개와 비교</button><button className={saved ? "secondary-button" : "primary-button"} disabled={busy || saved || durationFilter === "short"} onClick={() => saveOutlier(item)}><Star size={14} /> {saved ? "근거 저장됨" : "틈새 근거로 저장"}</button><button className="secondary-button" disabled={busy} onClick={() => setBorrowItem(item)}>구조 빌려오기</button><label>팀 검토 적합도<select value={Number(decisions.get(item.id)?.metadata.fitScore ?? 0)} disabled={busy} onChange={(event) => void reviewVideo(item, "review", Number(event.target.value))}><option value={0}>미검토</option><option value={1}>낮음</option><option value={2}>보통</option><option value={3}>높음</option></select></label><button className="ghost-button" disabled={busy} onClick={() => void reviewVideo(item, decisions.get(item.id)?.status === "blocked" ? "review" : "blocked", Number(decisions.get(item.id)?.metadata.fitScore ?? 0))}>{decisions.get(item.id)?.status === "blocked" ? "검토 제외 취소" : "팀 검토에서 제외"}</button></div></article>;
      })}</section> : <div className="panel compact-empty discovery-empty"><Radar size={28} /><strong>키워드로 시장 영상을 탐색하세요.</strong><span>검색 결과는 저장하기 전까지 운영 데이터에 들어가지 않습니다.</span></div>}
      <section className="panel content-data-table search-history-table"><div className="panel-header"><div><h2>탐색 이력</h2><p>같은 키워드는 묶어 표시합니다. 누르면 검색창에 다시 채워집니다.</p></div></div><div className="content-table-head"><span>키워드</span><span>실행</span><span>마지막 실행자</span><span>마지막 실행</span></div>{searchSummaries.slice(0, 12).map((search) => <button type="button" className="content-table-row" key={search.key} onClick={() => setSearchQuery(search.query)}><span><strong>{search.query}</strong><small>최근 결과 {search.resultCount === null ? "미집계" : `${search.resultCount}개`} · 최고 조회 {search.topViewCount === null ? "미집계" : compactNumber(search.topViewCount)}</small></span><span>{search.count}회</span><span>{memberNames[search.latestActorId] ?? (search.latestActorId === profile?.id ? profile.displayName : "실행자 미확인")}</span><span>{new Date(search.latestAt).toLocaleString("ko-KR")}</span></button>)}</section>
    </> : null}

    {tab === "niches" || tab === "planning" ? <>
      <section className="niche-summary-grid">
        <div className="panel"><Flag size={17} /><span><strong>{topics.filter((item) => item.status === "planned").length}</strong><small>기획으로 넘기기</small></span></div>
        <div className="panel"><Eye size={17} /><span><strong>{topics.filter((item) => item.status === "review").length}</strong><small>더 지켜보기</small></span></div>
        <div className="panel"><Target size={17} /><span><strong>{outliers.length}</strong><small>단일 근거 영상</small></span></div>
        <div className="panel"><FileText size={17} /><span><strong>{plans.length}</strong><small>완성 기획안</small></span></div>
      </section>
      {notice ? <p className="inline-alert" role="status">{notice}</p> : null}
      <section className="content-planning-layout">
        <aside className="panel source-list niche-list"><div className="panel-header"><div><h2>{tab === "planning" ? "확정된 기획" : "틈새 후보"}</h2><p>{tab === "planning" ? "틈새 판정을 통과해 다음 공정으로 넘긴 주제" : "미정이거나 더 확인할 주제"}</p></div></div>{visibleTopics.map((topic) => <button className={selected?.id === topic.id ? "active" : ""} key={topic.id} onClick={() => setSelectedId(topic.id)}><span><strong>{topic.title}</strong><small>{topic.stage || "미정"} · 근거 {topic.source_url ? "있음" : "미입력"}</small></span><ArrowRight size={14} /></button>)}{!visibleTopics.length ? <div className="list-empty">{tab === "planning" ? "아직 확정된 기획이 없습니다." : "틈새 후보를 추가하거나 탐색 결과를 저장하세요."}</div> : null}</aside>
        <article className="panel planning-detail niche-detail">{selected ? <>
          <header><div><span className={`status-pill status-${selected.status}`}>{selected.stage || "미정"}</span><h2>{selected.title}</h2><p>{selected.description}</p>{selected.metadata.structureBorrow ? <p><span className="status-pill">구조 차용</span> · <a href={selected.source_url || "#"} target="_blank" rel="noreferrer">원본 영상 미리보기</a> · 원문을 복사하지 않고 갚을 수 있는 약속만 검토하세요.</p> : null}</div><ContentGenerationButton className="primary-button" disabled={busy || !researchReady} title={researchReady ? "검증된 소구점으로 기획안을 만듭니다." : workflowState.blocker} onGenerate={makePlan}><Sparkles size={14} /> 기획안 만들기</ContentGenerationButton></header>
          <form className="planning-facts planning-readiness" key={`${selected.id}-${selected.version}`} onSubmit={saveReadiness}>
            <label>대표 시청자<input name="audience" defaultValue={meta(selected, "audience", "")} placeholder="이 콘텐츠를 가장 먼저 볼 사람" /></label>
            <label>사람들이 찾는 말<input name="entryLanguage" defaultValue={meta(selected, "entryLanguage", "")} placeholder="실제로 찾는 질문·검색어" /></label>
            <label>콘텐츠 위계<input name="hierarchy" defaultValue={meta(selected, "hierarchy", "")} placeholder="어떤 주제 아래에 속하나요?" /></label>
            <label>시장 근거 영상 주소<input name="evidence" type="url" defaultValue={selected.source_url || ""} placeholder="https://youtube.com/…" /><Link href="/content/topics?tab=discovery">탐색에서 영상 연결</Link></label>
            <div className="planning-readiness-footer"><small>{readinessMissing.length ? `미입력: ${readinessMissing.join(" · ")}` : "기획 준비도 4/4 완료"}</small><button type="submit" className="secondary-button" disabled={busy}>준비도 저장</button></div>
          </form>
          <section className="appeal-workflow">
            <div className="appeal-workflow-head"><div><span className="eyebrow">현재 세부 단계</span><h3>{workflowState.stage}</h3><p>{workflowState.nextAction}</p></div><ContentGenerationButton type="button" className={appealSet ? "secondary-button" : "primary-button"} disabled={busy} onGenerate={makeAppeals}><Sparkles size={14} /> {appealSet ? "소구점 후보 다시 만들기" : "소구점 후보 약 10개 만들기"}</ContentGenerationButton></div>
            <dl className="appeal-status-grid"><div><dt>승인</dt><dd>{approvedAppealItems.length}개</dd></div><div><dt>막힌 이유</dt><dd>{workflowState.blocker || "없음"}</dd></div></dl>
            <details className="appeal-technical-details"><summary>기술 정보</summary><dl><div><dt>content_id</dt><dd>{selected.id}</dd></div><div><dt>후보 세트 버전</dt><dd>{appealSet ? String(meta(appealSet, "candidateSetVersion", appealSet.created_at)) : "없음"}</dd></div></dl></details>
            {appealSet ? <p className="appeal-approvers">승인자 {appealAssignments.filter((item) => item.kind === "approver").map((item) => memberNames[item.user_id] ?? "구성원").join(", ") || "미지정 · 관리자"} · <Link href="/settings/company">위임 설정</Link>{appealApprovalLoaded && !appealCanApprove ? " · 내 승인 권한 없음" : ""}</p> : null}
            {appealSet ? <button type="button" className="secondary-button" disabled={busy || readinessMissing.length > 0} title={readinessMissing.length ? `미입력: ${readinessMissing.join(" · ")}` : "승인자와 유효한 위임자에게 알림을 보냅니다."} onClick={() => void requestAppealApproval()}>승인 요청 보내기</button> : null}
            {appealCandidates.length ? <div className="appeal-candidate-list">
              {appealCandidates.map((candidate, index) => <article className={`appeal-candidate decision-${candidate.decision}`} key={`${candidate.text}-${index}`}><label><input type="checkbox" aria-label={`${index + 1}번 소구점 선택`} checked={selectedAppeals.has(index)} onChange={(event) => setSelectedAppeals((current) => { const next = new Set(current); if (event.target.checked) next.add(index); else next.delete(index); return next; })} /> {index + 1}</label><strong>{candidate.text}</strong><span className="status-pill">{candidate.decision === "approved" ? "승인" : candidate.decision === "revision" ? "수정 요청" : candidate.decision === "held" ? "보류" : "미결정"}</span><button type="button" className="ghost-button" onClick={() => { setAppealCommentIndex(appealCommentIndex === index ? null : index); setAppealCommentBody(""); }}>댓글 {appealComments.filter((item) => item.candidate_index === index).length}</button>{appealCommentIndex === index ? <div className="appeal-candidate-comment">{appealComments.filter((item) => item.candidate_index === index).map((item) => <p key={item.id}><strong>{memberNames[item.author_id] ?? "구성원"}</strong> · {new Date(item.created_at).toLocaleString("ko-KR")}<br />{item.body}</p>)}<textarea aria-label={`${index + 1}번 소구점 댓글`} value={appealCommentBody} maxLength={2000} onChange={(event) => setAppealCommentBody(event.target.value)} placeholder="확인할 점이나 수정 의견" /><button type="button" className="secondary-button" disabled={busy || !appealCommentBody.trim()} onClick={() => void addAppealComment()}>댓글 저장</button>{appealCommentError ? <small role="alert">{appealCommentError}</small> : null}</div> : null}</article>)}
              <div className="appeal-bulk-actions"><strong>{selectedAppeals.size}개 선택됨</strong><input aria-label="소구점 판정 메모" maxLength={500} value={appealNote} onChange={(event) => setAppealNote(event.target.value)} placeholder="수정 요청 사유 · 판정 메모" /><button type="button" className="primary-button" disabled={busy || !selectedAppeals.size || !appealApprovalLoaded || !appealCanApprove} onClick={() => void decideAppeals([...selectedAppeals], "approved")}>승인</button><button type="button" className="secondary-button" disabled={busy || !selectedAppeals.size || !appealNote.trim() || !appealApprovalLoaded || !appealCanApprove} onClick={() => void decideAppeals([...selectedAppeals], "revision")}>수정 요청</button><button type="button" className="secondary-button" disabled={busy || !selectedAppeals.size || !appealApprovalLoaded || !appealCanApprove} onClick={() => void decideAppeals([...selectedAppeals], "held")}>보류</button><button type="button" className="ghost-button" disabled={busy || !selectedAppeals.size} onClick={() => setSelectedAppeals(new Set())}>선택 해제</button></div>
            </div> : <div className="list-empty">아직 후보가 없습니다. 이 단계에서는 설명이나 레퍼런스 없이 짧은 소구점만 만듭니다.</div>}
          </section>
          {approvedAppealItems.length ? <form className="research-brief" key={`${selected.id}-${selected.version}-${appealSet?.version ?? 0}`} onSubmit={saveResearchBrief}>
            <div><h3>승인 소구점 레퍼런스 검증</h3><p>YouTube와 Instagram Reels 출처를 남기고, 세 가지 적합성과 확인 한계를 각각 기록합니다. 확인하지 못한 수치는 비워 두세요.</p></div>
            <label><span>YouTube 출처 · 한 줄에 하나</span><textarea name="youtubeSources" rows={3} defaultValue={(researchBrief.youtubeUrls as string[] | undefined ?? (selected.source_url && !selected.source_url.includes("instagram.com") ? [selected.source_url] : [])).join("\n")} placeholder="https://youtube.com/…" /></label>
            <label><span>Instagram Reels 출처 · 한 줄에 하나</span><textarea name="instagramSources" rows={3} defaultValue={(researchBrief.instagramUrls as string[] | undefined ?? (selected.source_url?.includes("instagram.com") ? [selected.source_url] : [])).join("\n")} placeholder="https://instagram.com/reel/…" /></label>
            <label><span>주제 적합성</span><textarea name="topicFit" required rows={3} defaultValue={String(researchBrief.topicFit ?? "")} placeholder="이 레퍼런스가 승인 소구점의 주제를 얼마나 직접 다루는지" /></label>
            <label><span>핵심 대상 적합성</span><textarea name="audienceFit" required rows={3} defaultValue={String(researchBrief.audienceFit ?? "")} placeholder="우리 핵심 대상과 레퍼런스 시청자가 어떻게 맞는지" /></label>
            <label><span>검색 의도 적합성</span><textarea name="queryIntentFit" required rows={3} defaultValue={String(researchBrief.queryIntentFit ?? "")} placeholder="사람이 실제로 찾는 질문·검색 의도와 어떻게 맞는지" /></label>
            <label><span>검증된 수치 · 선택</span><textarea name="verifiedMetrics" rows={3} defaultValue={String(researchBrief.verifiedMetrics ?? "")} placeholder="직접 확인한 조회·반응 수치와 확인 시각만 기록" /></label>
            <label><span>검증 한계 · 필수</span><textarea name="limitations" required rows={3} defaultValue={String(researchBrief.limitations ?? "")} placeholder="확인하지 못한 수치, 플랫폼 차이, 해석의 한계" /></label>
            <label><span>분석 메모</span><textarea name="analystNotes" rows={3} defaultValue={String(researchBrief.analystNotes ?? "")} placeholder="구조·훅·증거에서 참고할 점" /></label>
            <label><span>브랜드 맥락</span><textarea name="brandContext" rows={3} defaultValue={String(researchBrief.brandContext ?? "")} placeholder="브랜디액션 관점에서 가져올 것과 가져오지 않을 것" /></label>
            <div className="drawer-actions"><button className="secondary-button" disabled={busy}>검증 내용 저장</button>{selected.status === "planned" ? <a className="primary-button" href={`/content/packages?sourceId=${selected.id}`}>제목·썸네일 작업으로 인계 <ArrowRight size={14} /></a> : null}</div>
          </form> : <div className="research-locked"><CircleAlert size={16} /><div><strong>레퍼런스 검증 잠김</strong><p>먼저 진행할 소구점을 한 개 이상 승인해 주세요.</p></div></div>}
          {tab === "niches" ? <section className="niche-decision-bar"><div><strong>사람 판정</strong><small>소구점 승인과 레퍼런스 검증이 끝난 주제만 기획으로 넘길 수 있습니다.</small></div><button className="ghost-button" disabled={busy} onClick={() => decideTopic("blocked")}>보류</button><button className="secondary-button" disabled={busy} onClick={() => decideTopic("review")}>더 지켜보기</button><button className="primary-button" disabled={busy || !researchReady} onClick={() => decideTopic("planned")}><Check size={14} /> 기획으로 넘기기</button></section> : <section className="niche-decision-bar"><div><strong>기획 전달 완료</strong><small>확정된 주제입니다. 정본 후보를 만들거나 다음 콘텐츠 공정에서 이어서 작업하세요.</small></div><button className="secondary-button" disabled={busy} onClick={() => decideTopic("review")}>틈새로 되돌리기</button></section>}
          {candidates.length ? <div className="planning-candidates"><h3>기획 방향 후보 <small>제목·썸네일은 패키징에서 최종 확정</small></h3>{candidates.map((candidate, index) => <article className={candidate.picked ? "picked" : ""} key={`${String(candidate.title)}-${index}`}><div><strong>{String(candidate.title ?? "기획 방향 후보")}</strong><p>{String(candidate.thumbnailCopy ?? "")}</p><small>{String(candidate.narrative ?? candidate.evidence ?? "")}</small></div><button className="ghost-button" onClick={() => pickCandidate(index)}>{candidate.picked ? "★ 채택됨" : "☆ 채택"}</button></article>)}{planningReady ? <div className="planning-next-actions"><Link className="secondary-button" href={`/content/automation?sourceId=${selected.id}`}>기획·근거 승인하기</Link><Link className="primary-button" href={`/content/packages?sourceId=${selected.id}`}>제목·썸네일에서 이어하기 <ArrowRight size={14} /></Link></div> : null}</div> : <div className="list-empty"><Sparkles size={20} /> 승인된 소구점과 레퍼런스 검증을 바탕으로 기획안을 만들면 다음 공정 HANDOFF가 표시됩니다.</div>}
          {showPlanningHandoff ? <ContentPlanningHandoff key={`handoff:${selected.id}:${selected.version}`} source={selected} onSaved={(record) => { setRecords((current) => current.map((item) => item.id === record.id ? record : item)); setNotice("인계 메모를 저장했습니다. 승인·공유는 실행되지 않았습니다."); }} /> : null}
          {String(planResult.handoff ?? "") ? <section className="handoff-box"><span>다음에 할 일 · 넘길 말</span><p>{String(planResult.handoff)}</p></section> : null}
          {showTopicJevAssist ? <ContentTopicJevAssist key={`topic-jev:${selected.id}:${selected.version}:${plan?.id ?? "no-plan"}:${plan?.version ?? 0}`} topicId={selected.id} topicVersion={selected.version} {...(plan ? { planId: plan.id, planVersion: plan.version } : {})} /> : null}
        </> : <div className="compact-empty"><Target size={24} /><strong>판정할 틈새를 선택하세요.</strong></div>}</article>
      </section>
    </> : null}

    {borrowItem ? <div className="drawer-backdrop"><form className="record-drawer" onSubmit={borrow}><div className="drawer-head"><h2>구조 빌려오기</h2><button type="button" className="icon-button" disabled={busy} onClick={() => setBorrowItem(null)} aria-label="구조 차용 닫기"><X size={18} /></button></div><p>원본: <a href={borrowItem.url} target="_blank" rel="noreferrer">{borrowItem.title}</a></p><p>원본의 제목·결론은 복제하지 않습니다. 제목 골격과 반전·약속 구조를 우리 주제로 옮긴 뒤 사람이 채택합니다.</p><label><span>우리 주제</span><input name="topic" required maxLength={200} /></label><label><span>실제로 설명·제공할 수 있는 내용</span><textarea name="fulfillment" required minLength={10} maxLength={3000} rows={5} /></label>{error ? <p role="alert">{error}</p> : null}<div className="drawer-actions"><button type="button" disabled={busy} className="secondary-button" onClick={() => setBorrowItem(null)}>취소</button><button className="primary-button" disabled={busy}>검토 후보 저장</button></div></form></div> : null}
    {channelOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setChannelOpen(false)}><form className="record-drawer" onSubmit={addChannel} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">관찰 채널</span><h2>매일 보는 채널 추가</h2></div><button type="button" className="icon-button" onClick={() => setChannelOpen(false)}><X size={18} /></button></div><label><span>YouTube 채널 URL · @핸들 · 채널 ID</span><div className="channel-verify-row"><input value={channelInput} onChange={(event) => { setChannelInput(event.target.value); setVerifiedChannel(null); }} required placeholder="https://www.youtube.com/@…" /><button type="button" className="secondary-button" disabled={busy} onClick={verifyChannel}><Search size={14} /> 채널 확인</button></div></label>{verifiedChannel ? <section className="verified-channel"><span style={{ backgroundImage: `url(${verifiedChannel.thumbnail})` }} /><div><strong>{verifiedChannel.title}</strong><small>{verifiedChannel.handle} · 구독자 {verifiedChannel.subscribers.toLocaleString("ko-KR")} · 영상 {verifiedChannel.videos.toLocaleString("ko-KR")}</small><p>{verifiedChannel.description || "채널 설명 없음"}</p></div><Check size={17} /></section> : <div className="inline-alert warning"><CircleAlert size={15} /> 이름 검색으로 추측하지 않습니다. 채널 URL 또는 @핸들로 정확한 채널을 먼저 확인하세요.</div>}<div className="form-grid"><label><span>입구 분류</span><select name="category">{ENTRY_CATEGORIES.map(([letter, name]) => <option value={`${letter}. ${name}`} key={letter}>{letter}. {name}</option>)}</select></label><label><span>대표 형식</span><select name="format"><option>해설</option><option>인터뷰</option><option>강의</option><option>브이로그</option><option>사례 분석</option></select></label></div><label><span>운영하는 곳</span><input name="ownerGroup" placeholder="개인·회사·미디어명" /></label><label><span>승인 근거</span><textarea name="reason" rows={4} placeholder="왜 계속 볼 채널인지, 반복해서 확인할 신호" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setChannelOpen(false)}>취소</button><button className="primary-button" disabled={busy || !verifiedChannel}>매일 보는 채널 저장</button></div></form></div> : null}
    {topicOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setTopicOpen(false)}><form className="record-drawer" onSubmit={addTopic} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">틈새 입력</span><h2>새 주제 후보</h2></div><button type="button" className="icon-button" onClick={() => setTopicOpen(false)}><X size={18} /></button></div><label><span>틈새·주제</span><input name="title" required /></label><label><span>시청자가 겪는 현상·문제</span><textarea name="problem" required rows={4} /></label><div className="form-grid"><label><span>대표 시청자</span><input name="audience" /></label><label><span>콘텐츠 위계</span><select name="hierarchy"><option>유입형</option><option>전환형</option><option>판매형</option></select></label></div><label><span>사람들이 찾는 말</span><input name="entryLanguage" /></label><div className="form-grid"><label><span>채널명</span><input name="channel" /></label><label><span>브랜드</span><input name="brand" defaultValue="브랜디액션" /></label></div><label><span>근거·수치</span><textarea name="evidence" rows={3} /></label><label><span>근거 영상 URL</span><input type="url" name="sourceUrl" /></label><label><span>키워드</span><input name="keywords" placeholder="쉼표로 구분" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setTopicOpen(false)}>취소</button><button className="primary-button" disabled={busy}>틈새 후보 저장</button></div></form></div> : null}
  </>;
}
