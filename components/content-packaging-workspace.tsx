"use client";

import {useQueryTab} from "./use-query-tab";
import { PageTitle } from "./page-title";

import Link from "next/link";
import {
  Bookmark,
  Check,
  CircleAlert,
  Clipboard,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  PackageCheck,
  Search,
  Sparkles,
  Star,
  Target,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, createRecord, listAllRecordsOfType, generateContent, listRecords, searchYoutubeMarket, updateRecord, type YoutubeMarketItem } from "@/lib/api-client";
import { pickedPlanningCandidate, planningSelectionReady } from "@/lib/content-pipeline";
import type { OsRecord } from "@/lib/record-types";
import { filterContentOrigin, sourceSelection, type ContentOriginFilter as OriginFilter } from "@/lib/content-origin";
import { ContentOriginFilter } from "./content-origin-filter";
import { useSession } from "./session-provider";
import { ContentJevAssist } from "./content-jev-assist";
import { ContentJevUsageGuide, packagingJevUsageSteps } from "./content-jev-usage-guide";

type PackageTab = "search" | "title" | "thumbnail" | "saved";

const PACKAGE_TABS: Array<{ key: PackageTab; label: string; hint: string }> = [
  { key: "search", label: "검색", hint: "시장 레퍼런스" },
  { key: "title", label: "제목", hint: "공식·후보" },
  { key: "thumbnail", label: "썸네일", hint: "카피·디자인" },
  { key: "saved", label: "저장함", hint: "채택·레퍼런스" },
];

function meta<T>(record: OsRecord | null | undefined, key: string, fallback: T): T {
  const found = record?.metadata?.[key];
  return found == null ? fallback : found as T;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function CandidateList({ title, subtitle, items, copied, onCopy, onPick }: {
  title: string;
  subtitle: string;
  items: Array<Record<string, unknown>>;
  copied: string;
  onCopy: (key: string, value: string) => void;
  onPick?: (index: number) => void;
}) {
  return <section className="panel candidate-panel package-candidates"><div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div><span>{items.length}개</span></div>{items.length ? <div className="candidate-list">{items.map((item, index) => {
    const candidate = String(item.text ?? item.title ?? item);
    const key = `${title}-${index}`;
    return <article className={item.picked ? "picked" : ""} key={`${candidate}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{candidate}</strong>{item.hook ? <p>{String(item.hook)}</p> : null}{item.why ? <small>{String(item.why)}</small> : null}</div><div className="candidate-actions"><button className="icon-button" aria-label={`${candidate} 복사`} onClick={() => onCopy(key, candidate)}><Clipboard size={13} /></button>{onPick ? <button className="candidate-pick" onClick={() => onPick(index)}>{item.picked ? "★ 채택" : "☆ 채택"}</button> : null}<small>{copied === key ? "복사됨" : ""}</small></div></article>;
  })}</div> : <div className="compact-empty"><Sparkles size={24} /><strong>생성된 후보가 없습니다.</strong><span>시장 근거를 모은 뒤 후보 생성을 실행하세요.</span></div>}</section>;
}

export function ContentPackagingWorkspace({ showJevAssist = false, lockedSource }: { showJevAssist?: boolean; lockedSource?:OsRecord }) {
  const { accessToken, demo, profile } = useSession();
  const [allSources, setSources] = useState<OsRecord[]>(lockedSource?[lockedSource]:[]);
  const [origin, setOrigin] = useState<OriginFilter>("own");
  const sources = lockedSource ? allSources.filter(row=>row.id===lockedSource.id) : filterContentOrigin(allSources, origin);
  const [packages, setPackages] = useState<OsRecord[]>([]);
  const [sourceId, setSourceId] = useState(lockedSource?.id??"");
  const [tab, setTab] = useQueryTab<PackageTab>("tab",["search","title","thumbnail","saved"],"search");
  const [marketQuery, setMarketQuery] = useState("");
  const [marketResults, setMarketResults] = useState<YoutubeMarketItem[]>([]);
  const [ownMetrics, setOwnMetrics] = useState<OsRecord[]>([]);
  const [ownSort, setOwnSort] = useState("ctr");
  const [ownResults, setOwnResults] = useState<YoutubeMarketItem[]>([]);
  const [minViews, setMinViews] = useState(10_000);
  const [sort, setSort] = useState<"ratio" | "views" | "engagement" | "subscribers">("ratio");
  const [format, setFormat] = useState<"all" | "long" | "short">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [quickTopicOpen, setQuickTopicOpen] = useState(false);
  const [pipelineState, setPipelineState] = useState<{ approved: boolean[]; missing: string[][] } | null>(null);

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [sourceResult, packageResult, metrics] = await Promise.all([
        listAllRecordsOfType(accessToken, "content_topic").then(records => ({ records })),
        listRecords(accessToken, "content_package", "limit=200"),
        listAllRecordsOfType(accessToken, "content_metric"),
      ]);
      setSources(sourceResult.records);
      setPackages(packageResult.records); setOwnMetrics(metrics);
      setSourceId((current) => lockedSource ? (sourceResult.records.some(row=>row.id===lockedSource.id)?lockedSource.id:"") : sourceSelection(sourceResult.records, current, new URLSearchParams(window.location.search).get("sourceId") ?? ""));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "패키징 자료를 불러오지 못했습니다.");
    }
  }, [accessToken, demo, lockedSource]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sourceId || demo) { setPipelineState(null); return; }
    let active = true;
    setPipelineState(null);
    apiRequest<{ approved: boolean[]; missing: string[][] }>(`/api/v1/content/pipeline?sourceId=${encodeURIComponent(sourceId)}`, { token: accessToken })
      .then((value) => { if (active) setPipelineState(value); })
      .catch(() => { if (active) setPipelineState(null); });
    return () => { active = false; };
  }, [accessToken, demo, sourceId]);

  const titlePackages = packages.filter((record) => meta<string>(record, "packageKind", "") === "title_package");
  const references = packages.filter((record) => meta<string>(record, "packageKind", "") === "market_reference");
  const latest = titlePackages
    .filter((record) => record.parent_id === sourceId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
  const result = meta<Record<string, unknown>>(latest, "result", {});
  const titles = Array.isArray(result.titles) ? result.titles as Array<Record<string, unknown>> : [];
  const copies = Array.isArray(result.copies) ? result.copies as Array<Record<string, unknown>> : [];
  const pickedTitles = titles.filter((item) => item.picked === true);
  const pickedCopies = copies.filter((item) => item.picked === true);
  const prompts = Array.isArray(result.designPrompts) ? result.designPrompts.map((text) => ({ text })) : [];
  const measuredCtr = (id: string) => {
    const record = ownMetrics.find((item) => item.metadata.youtubeId === id || item.metadata.youtubeVideoId === id || item.metadata.contentId === id || item.source_url?.includes(`v=${id}`));
    const value = record?.metadata.ctr;
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const sortedOwn = [...ownResults].sort((a, b) => ownSort === "ctr" ? (measuredCtr(b.id) ?? -1) - (measuredCtr(a.id) ?? -1) : b.viewCount - a.viewCount);
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;
  const selectedPlan = packages.filter((record) => record.parent_id === sourceId && meta<string>(record, "packageKind", "") === "topic_plan")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
  const pickedPlan = pickedPlanningCandidate(selectedPlan);
  const pipelineEnabled = selectedSource?.metadata.pipelineEnabled === true;
  const planningReady = Boolean(selectedSource && planningSelectionReady(selectedSource, selectedPlan));
  const planningApproved = !pipelineEnabled || pipelineState?.approved?.[0] === true;
  const canGenerate = Boolean(sourceId && (!pipelineEnabled || (planningReady && planningApproved)));
  const researchBrief = selectedSource?.metadata.researchBrief && typeof selectedSource.metadata.researchBrief === "object"
    ? selectedSource.metadata.researchBrief as Record<string, unknown>
    : {};
  const approvedAppeals = Array.isArray(researchBrief.approvedAppeals) ? researchBrief.approvedAppeals : [];
  const referenceCount = [...(Array.isArray(researchBrief.youtubeUrls) ? researchBrief.youtubeUrls : []), ...(Array.isArray(researchBrief.instagramUrls) ? researchBrief.instagramUrls : [])].length;
  const generationBlocker = !planningReady ? "주제·기획에서 기획 방향 한 개를 먼저 채택해 주세요."
    : !planningApproved ? "제작 공정에서 현재 기획·근거를 사람이 승인해 주세요." : "";
  const sortedResults = useMemo(() => marketResults.filter((item) => item.viewCount >= minViews).filter((item) => format === "all" || (format === "long" ? item.durationSeconds >= 240 : item.durationSeconds < 240)).sort((a, b) => {
    if (sort === "ratio") return (b.viewSubscriberRatio ?? -1) - (a.viewSubscriberRatio ?? -1) || b.viewCount - a.viewCount;
    if (sort === "subscribers") return (b.subscribers ?? -1) - (a.subscribers ?? -1);
    if (sort === "engagement") {
      const scoreA = a.viewCount ? (a.likeCount + a.commentCount) / a.viewCount : 0;
      const scoreB = b.viewCount ? (b.likeCount + b.commentCount) / b.viewCount : 0;
      return scoreB - scoreA;
    }
    return b.viewCount - a.viewCount;
  }), [format, marketResults, minViews, sort]);

  const searchMarket = async (ours = false) => {
    const query = ours ? "" : marketQuery.trim() || selectedSource?.title || "";
    if (!ours && query.length < 2) return setError("시장 검색어를 두 글자 이상 입력해 주세요.");
    setBusy(true); setError("");
    try {
      const response = await searchYoutubeMarket(accessToken, query, ours ? 12 : 20, { own: ours });
      if (ours) setOwnResults(response.items); else setMarketResults(response.items);
      if (!response.items.length) setError("검색된 시장 영상이 없습니다. 검색어를 넓혀보세요.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "시장 레퍼런스를 불러오지 못했습니다.");
    } finally { setBusy(false); }
  };

  const saveReference = async (item: YoutubeMarketItem, query: string) => {
    if (references.some((record) => meta(record, "youtubeId", "") === item.id)) return;
    setBusy(true); setError("");
    try {
      await createRecord(accessToken, {
        recordType: "content_package",
        title: item.title,
        description: `${item.channelTitle} · 조회 ${item.viewCount.toLocaleString("ko-KR")}`,
        status: "ready",
        priority: "normal",
        stage: "레퍼런스 저장",
        team: profile?.team || "콘텐츠",
        parentId: sourceId || null,
        sourceUrl: item.url,
        tags: ["썸네일레퍼런스", query].filter(Boolean),
        metadata: { packageKind: "market_reference", youtubeId: item.id, query, thumbnail: item.thumbnail, channelTitle: item.channelTitle, views: item.viewCount, likes: item.likeCount, comments: item.commentCount, publishedAt: item.publishedAt },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "레퍼런스를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const generate = async () => {
    if (!sourceId) return;
    if (pipelineEnabled && generationBlocker) return setError(generationBlocker);
    setBusy(true); setError("");
    try {
      const evidence = sortedResults.map(({ title, channelTitle, viewCount, url }) => ({ title, channelTitle, viewCount, url }));
      const response = await generateContent(accessToken, { action: "title_package", sourceId, marketEvidence: evidence });
      if (response.queued) setError("Claude 연결 대기 작업으로 저장했습니다.");
      else {
        if (response.records?.length) {
          setPackages((current) => [
            ...response.records!,
            ...current.filter((record) => !response.records!.some((created) => created.id === record.id)),
          ]);
        }
        setTab("title");
      }
      void load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "제목·썸네일 후보를 만들지 못했습니다.");
    } finally { setBusy(false); }
  };

  const pick = async (kind: "titles" | "copies", index: number) => {
    if (!latest) return;
    const items = kind === "titles" ? titles : copies;
    const selecting = items[index]?.picked !== true;
    const next = items.map((item, itemIndex) => ({ ...item, picked: selecting && itemIndex === index }));
    setBusy(true); setError("");
    try {
      await updateRecord(accessToken, { id: latest.id, expectedVersion: latest.version, metadata: { ...latest.metadata, result: { ...result, [kind]: next } } });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "채택 상태를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1200);
  };

  const createQuickTopic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) return;
    setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "content_topic", title, description: String(form.get("problem") ?? "").trim(),
        status: "backlog", priority: "normal", team: profile?.team || "콘텐츠", brand: String(form.get("brand") ?? "브랜디액션"),
        tags: ["빠른검증", "임시주제"], metadata: { studioKind: "quick_validation", temporary: true },
      });
      setQuickTopicOpen(false); await load(); setSourceId(record.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "검증 주제를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle /><p>자사·시장 썸네일을 근거로 모으고, 정본에서 제목·카피·디자인 프롬프트를 생성해 채택합니다.</p></div><div className="header-actions">{!lockedSource ? <ContentOriginFilter value={origin} onChange={value => { setOrigin(value); setSourceId(""); }} /> : null}<select aria-label="기준 콘텐츠 선택" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">기준 콘텐츠 선택</option>{sources.map((source) => <option key={source.id} value={source.id}>{meta(source, "temporary", false) ? "[빠른 검증] " : source.metadata.pickedCandidate ? "[패키징 준비] " : "[기획 미확정] "}{source.title}</option>)}</select><button className="secondary-button" onClick={() => setQuickTopicOpen(true)}><Target size={15} /> 새 주제로 검증</button><button className="primary-button" title={generationBlocker || "현재 기획으로 제목·썸네일 후보를 만듭니다."} disabled={!canGenerate || busy} onClick={generate}><Sparkles size={15} /> {busy ? "처리 중…" : "제목·썸네일 후보 뽑기"}</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    {selectedSource && pipelineEnabled ? <section className="panel packaging-handoff" aria-label="기획에서 패키징으로 인계"><header className="panel-header"><div><span className="eyebrow">같은 콘텐츠에서 이어서 작업</span><h2>{selectedSource.title}</h2><p>주제·기획에서 승인한 범위를 그대로 확인하고, 최종 제목과 썸네일은 이 화면에서 결정합니다.</p></div><span className={`status-pill status-${planningApproved ? "ready" : "review"}`}>{planningApproved ? "기획·근거 승인 완료" : "기획·근거 승인 대기"}</span></header><dl className="appeal-status-grid"><div><dt>content_id</dt><dd>{selectedSource.id}</dd></div><div><dt>현재 단계</dt><dd>{selectedSource.stage || "패키징 준비"}</dd></div><div><dt>승인 소구점</dt><dd>{approvedAppeals.length}개</dd></div><div><dt>검증 레퍼런스</dt><dd>{referenceCount}개</dd></div></dl>{pickedPlan ? <article className="packaging-plan-card"><small>채택한 기획 방향 · 기획 v{selectedPlan?.version}</small><strong>{String(pickedPlan.title ?? "기획 방향")}</strong><p>{String(pickedPlan.narrative ?? pickedPlan.evidence ?? "")}</p><span>기획 단계의 제목·썸네일 문구는 방향 참고이며, 최종안은 이 화면에서 채택합니다.</span></article> : null}{generationBlocker ? <p className="inline-alert warning"><CircleAlert size={15} /> {generationBlocker}</p> : null}<nav className="planning-next-actions"><Link className="secondary-button" href={`/content/topics?sourceId=${selectedSource.id}`}>주제·기획 확인</Link><Link className="secondary-button" href={`/content/automation?sourceId=${selectedSource.id}`}>공정·승인 현황</Link></nav></section> : null}
    <p className="field-hint">검색으로 근거 모으기 → 제목 선택 → 썸네일 카피·디자인 검토 → 채택 저장</p><p className="field-hint">내부 예상 비용: 제목 3~8원, 카피·디자인 20~35원. 실제 비용은 모델·입력 길이·생성 범위에 따라 달라집니다. 현재 버튼은 제목·카피·디자인을 함께 생성합니다.</p>
    <nav className="studio-tabs content-radar-tabs" aria-label="제목 썸네일 작업 단계">{PACKAGE_TABS.map((item) => <button className={tab === item.key ? "active" : ""} key={item.key} onClick={() => setTab(item.key)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</nav>

    {tab === "search" ? <>
      <section className="panel own-thumbnail-strip"><div className="panel-header"><div><h2>우리 채널 썸네일</h2><p>자사 채널의 기존 패키징과 저장된 실측 CTR을 확인합니다.</p></div><select aria-label="우리 채널 정렬" value={ownSort} onChange={(event) => setOwnSort(event.target.value)}><option value="ctr">실측 CTR 순</option><option value="views">조회순</option></select><button className="ghost-button" disabled={busy} onClick={() => searchMarket(true)}><Search size={14} /> 불러오기</button></div><div>{sortedOwn.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span style={{ backgroundImage: `url(${item.thumbnail})` }} /><strong>{item.title}</strong><small>조회 {compactNumber(item.viewCount)} · CTR {measuredCtr(item.id) === null ? "미연결" : `${measuredCtr(item.id)!.toFixed(1)}%`}</small></a>)}{!ownResults.length ? <button className="thumbnail-empty" onClick={() => searchMarket(true)}><ImageIcon size={24} /><span>우리 채널 썸네일 불러오기</span></button> : null}</div></section>
      <section className="panel package-search-console"><div className="panel-header"><div><h2>시장 썸네일 검색</h2><p>조회수와 반응을 확인하고 근거로 쓸 레퍼런스만 저장합니다.</p></div></div><div className="package-search-row"><div className="market-search"><Search size={16} /><input aria-label="시장 썸네일 검색어" value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchMarket(); }} placeholder="시장 검색어 · 비워두면 선택 콘텐츠 제목" /><button className="primary-button" disabled={busy} onClick={() => searchMarket()}>{busy ? "검색 중…" : "검색"}</button></div><label>형식<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="all">전체</option><option value="long">롱폼 4분+</option><option value="short">숏폼</option></select></label><label>최소 조회<select value={minViews} onChange={(event) => setMinViews(Number(event.target.value))}><option value={0}>전체</option><option value={10000}>1만+</option><option value={50000}>5만+</option><option value={100000}>10만+</option></select></label><label>정렬<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="ratio">구독자 대비 조회</option><option value="views">조회수</option><option value="engagement">반응률</option><option value="subscribers">구독자수</option></select></label></div></section>
      <section className="market-thumbnail-grid">{sortedResults.map((item) => { const saved = references.some((record) => meta(record, "youtubeId", "") === item.id); const engagement = item.viewCount ? (item.likeCount + item.commentCount) / item.viewCount * 100 : 0; return <article className="panel market-thumbnail-card" key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><span style={{ backgroundImage: `url(${item.thumbnail})` }}><i><Eye size={12} /> {compactNumber(item.viewCount)}</i></span></a><div><small>{item.channelTitle} · {item.durationSeconds >= 240 ? "롱폼" : "숏폼"} · {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("ko-KR") : "날짜 미상"}</small><h3>{item.title}</h3><p>조회 {item.viewCount.toLocaleString("ko-KR")} · 구독자 {item.subscribers?.toLocaleString("ko-KR") ?? "비공개"} · {item.viewSubscriberRatio == null ? "배수 측정 전" : `${item.viewSubscriberRatio.toLocaleString("ko-KR")}배`} · 반응 {engagement.toFixed(1)}%</p><button className={saved ? "secondary-button" : "ghost-button"} disabled={busy || saved} onClick={() => saveReference(item, marketQuery.trim())}><Bookmark size={13} /> {saved ? "저장됨" : "레퍼런스 저장"}</button></div></article>; })}{marketResults.length && !sortedResults.length ? <div className="panel compact-empty"><Target size={24} /><strong>조회 조건을 만족하는 영상이 없습니다.</strong><span>형식 또는 최소 조회 조건을 바꿔보세요.</span></div> : null}</section>
    </> : null}

    {tab === "title" ? <>
      <section className="panel package-formula"><Target size={19} /><div><small>시장 제목 공식</small><strong>{String(result.formula ?? "시장 근거를 포함해 후보를 생성하면 반복 공식이 표시됩니다.")}</strong><p>{String(result.summary ?? "")}</p></div></section>
      <CandidateList title="제목 후보" subtitle="정본 기준으로 생성된 출발 후보 · 채택 상태 자동 저장" items={titles} copied={copied} onCopy={copy} onPick={(index) => pick("titles", index)} />
    </> : null}

    {tab === "thumbnail" ? <div className="studio-two packaging-two"><CandidateList title="썸네일 카피" subtitle="짧고 말이 되는 문구만 채택합니다." items={copies} copied={copied} onCopy={copy} onPick={(index) => pick("copies", index)} /><CandidateList title="디자인 프롬프트" subtitle="이미지 생성물이 아닌 디자이너 전달용 지시문입니다." items={prompts} copied={copied} onCopy={copy} /></div> : null}

    {tab === "saved" ? <>
      <section className="studio-two packaging-two"><CandidateList title="채택한 제목" subtitle="현재 콘텐츠에 채택한 제목 후보" items={titles.filter((item) => item.picked)} copied={copied} onCopy={copy} /><CandidateList title="채택한 썸네일 카피" subtitle="현재 콘텐츠에 채택한 카피 후보" items={copies.filter((item) => item.picked)} copied={copied} onCopy={copy} /></section>
      {selectedSource && pickedTitles.length === 1 && pickedCopies.length === 1 ? <nav className="planning-next-actions"><Link className="primary-button" href={`/content/scripts?sourceId=${selectedSource.id}`}>현재 패키징 확정·자료 작업으로</Link></nav> : <p className="inline-alert warning">제목과 썸네일 카피를 각각 한 개 채택하면 자료·축·설계 단계로 넘어갈 수 있습니다.</p>}
      {showJevAssist && selectedSource && latest ? pickedTitles.length === 1 && pickedCopies.length === 1 ? <ContentJevAssist key={`${selectedSource.id}:${selectedSource.version}:${latest.id}:${latest.version}`} sourceId={selectedSource.id} sourceVersion={selectedSource.version} packageId={latest.id} packageVersion={latest.version} /> : <section className="panel content-jev-assist"><div className="panel-header"><div><h2>JEV 점수 보조 의견</h2><p>채택한 제목과 썸네일 카피를 바탕으로 참고 점수를 보여줍니다.</p></div></div><div className="content-jev-assist-body"><ContentJevUsageGuide steps={packagingJevUsageSteps} /></div></section> : null}
      <section className="panel saved-reference-list"><div className="panel-header"><div><h2>저장한 시장 레퍼런스</h2><p>원본 URL과 근거 수치를 유지합니다.</p></div><span>{references.length}개</span></div><div>{references.map((record) => <a href={record.source_url || "#"} target="_blank" rel="noreferrer" key={record.id}><span style={{ backgroundImage: `url(${meta(record, "thumbnail", "")})` }} /><span><strong>{record.title}</strong><small>{meta(record, "channelTitle", "")} · 조회 {Number(meta(record, "views", 0)).toLocaleString("ko-KR")}</small></span><ExternalLink size={13} /></a>)}{!references.length ? <div className="compact-empty"><Star size={24} /><strong>저장한 레퍼런스가 없습니다.</strong><span>검색 탭에서 시장 썸네일을 저장하세요.</span></div> : null}</div></section>
    </> : null}

    <section className="package-footnote"><Check size={14} /><span>제목·카피는 후보를 만들고 채택 상태만 저장합니다. 실제 썸네일 이미지는 이 화면에서 자동 생성하지 않습니다.</span><PackageCheck size={14} /></section>
    {quickTopicOpen ? <div className="drawer-backdrop" onMouseDown={() => setQuickTopicOpen(false)}><form className="record-drawer" onSubmit={createQuickTopic} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">빠른 검증</span><h2>새 주제로 검증</h2></div><button type="button" className="icon-button" onClick={() => setQuickTopicOpen(false)}>×</button></div><p className="field-hint">일반 주제·임시 검증 태그로 저장되며, 저장 즉시 기준 콘텐츠로 선택됩니다.</p><label><span>검증할 주제</span><input name="title" required /></label><label><span>시청자 문제·가설</span><textarea name="problem" rows={4} /></label><label><span>브랜드</span><input name="brand" defaultValue="브랜디액션" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setQuickTopicOpen(false)}>취소</button><button className="primary-button" disabled={busy}>저장하고 선택</button></div></form></div> : null}
  </>;
}
