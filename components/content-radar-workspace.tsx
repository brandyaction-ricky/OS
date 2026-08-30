"use client";

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
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRecord, generateContent, listRecords, resolveYoutubeChannel, searchYoutubeMarket, updateRecord, type YoutubeChannelIdentity, type YoutubeMarketItem } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type RadarTab = "channels" | "discovery" | "niches";

const TABS: Array<{ key: RadarTab; label: string; hint: string }> = [
  { key: "channels", label: "채널", hint: "관찰 채널 수집" },
  { key: "discovery", label: "탐색", hint: "터진 영상 발굴" },
  { key: "niches", label: "틈새", hint: "주제 확정" },
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

export function ContentRadarWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [packages, setPackages] = useState<OsRecord[]>([]);
  const [tab, setTab] = useState<RadarTab>("channels");
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<YoutubeMarketItem[]>([]);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [verifiedChannel, setVerifiedChannel] = useState<YoutubeChannelIdentity | null>(null);
  const [topicOpen, setTopicOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [topicResult, packageResult] = await Promise.all([
        listRecords(accessToken, "content_topic", "limit=200"),
        listRecords(accessToken, "content_package", "limit=200"),
      ]);
      setRecords(topicResult.records);
      setPackages(packageResult.records);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "콘텐츠 탐색 자료를 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);

  const channels = useMemo(() => records.filter((record) => meta<string>(record, "studioKind", "") === "channel"), [records]);
  const outliers = useMemo(() => records.filter((record) => meta<string>(record, "studioKind", "") === "outlier"), [records]);
  const topics = useMemo(() => records.filter((record) => {
    const kind = meta<string>(record, "studioKind", "");
    return !["channel", "outlier"].includes(kind) && record.metadata?.automationSource !== true;
  }), [records]);
  const plans = useMemo(() => packages.filter((record) => meta<string>(record, "packageKind", "") === "topic_plan"), [packages]);
  const searches = useMemo(() => packages.filter((record) => meta<string>(record, "packageKind", "") === "search_history"), [packages]);
  const selected = topics.find((topic) => topic.id === selectedId) ?? topics[0] ?? null;
  const plan = plans.find((record) => record.parent_id === selected?.id) ?? null;
  const planResult = meta<Record<string, unknown>>(plan, "result", {});
  const candidates = Array.isArray(planResult.candidates) ? planResult.candidates as Array<Record<string, unknown>> : [];

  useEffect(() => {
    if (!selectedId && topics[0]) setSelectedId(topics[0].id);
  }, [selectedId, topics]);

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
    const query = searchQuery.trim();
    if (query.length < 2) return setError("탐색 키워드를 두 글자 이상 입력해 주세요.");
    setBusy(true); setError("");
    try {
      const response = await searchYoutubeMarket(accessToken, query, 20);
      setResults(response.items);
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
    } finally { setBusy(false); }
  };

  const saveOutlier = async (item: YoutubeMarketItem) => {
    if (outliers.some((record) => meta(record, "youtubeId", "") === item.id)) return;
    setBusy(true); setError("");
    try {
      await createRecord(accessToken, {
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
        tags: ["아웃라이어", searchQuery.trim()].filter(Boolean),
        metadata: {
          studioKind: "outlier",
          youtubeId: item.id,
          channelTitle: item.channelTitle,
          thumbnail: item.thumbnail,
          publishedAt: item.publishedAt,
          views: item.viewCount,
          likes: item.likeCount,
          comments: item.commentCount,
          query: searchQuery.trim(),
        },
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "근거 영상을 저장하지 못했습니다.");
    } finally { setBusy(false); }
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

  const makePlan = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const response = await generateContent(accessToken, { action: "topic_plan", sourceId: selected.id });
      if (response.queued) setError("Claude 연결 대기 작업으로 저장했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기획 후보를 만들지 못했습니다.");
    } finally { setBusy(false); }
  };

  const decideTopic = async (status: "planned" | "review" | "blocked") => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await updateRecord(accessToken, {
        id: selected.id,
        expectedVersion: selected.version,
        status,
        stage: status === "planned" ? "기획으로 넘기기" : status === "blocked" ? "보류" : "더 지켜보기",
        metadata: { ...selected.metadata, decidedAt: new Date().toISOString() },
      });
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
      await Promise.all([
        updateRecord(accessToken, { id: plan.id, expectedVersion: plan.version, metadata: { ...plan.metadata, result: { ...planResult, candidates: next } } }),
        updateRecord(accessToken, { id: selected.id, expectedVersion: selected.version, status: "planned", stage: "기획으로 넘기기", metadata: { ...selected.metadata, pickedCandidate: next[index], handoff: String(planResult.handoff ?? ""), decidedAt: new Date().toISOString() } }),
      ]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "후보 채택을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  return <>
    <header className="page-header">
      <div className="page-title-group"><span className="eyebrow">콘텐츠 레이더</span><h1>주제·기획</h1><p>채널을 모으고 터진 영상을 발굴한 뒤, 반복 근거가 있는 틈새만 제작 기획으로 넘깁니다.</p></div>
      <div className="header-actions">
        {tab === "channels" ? <button className="primary-button" onClick={() => setChannelOpen(true)}><Plus size={15} /> 채널 추가</button> : null}
        {tab === "niches" ? <button className="primary-button" onClick={() => setTopicOpen(true)}><Plus size={15} /> 틈새 후보 추가</button> : null}
      </div>
    </header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <nav className="studio-tabs content-radar-tabs" aria-label="주제 탐색 단계">
      {TABS.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}
    </nav>

    {tab === "channels" ? <>
      <section className="metric-grid compact-metrics">
        <div className="metric-card"><div className="metric-top"><span>추적 채널</span><Users size={16} /></div><div className="metric-value">{channels.length}</div><div className="metric-caption">승인된 관찰 채널</div></div>
        <div className="metric-card"><div className="metric-top"><span>수집 영상</span><Youtube size={16} /></div><div className="metric-value">{channels.reduce((sum, channel) => sum + Number(meta(channel, "videoCount", 0)), 0)}</div><div className="metric-caption">채널 메타데이터 기준</div></div>
        <div className="metric-card"><div className="metric-top"><span>발견 근거</span><Radar size={16} /></div><div className="metric-value">{outliers.length}</div><div className="metric-caption">저장한 시장 영상</div></div>
        <div className="metric-card"><div className="metric-top"><span>기획 확정</span><Check size={16} /></div><div className="metric-value">{topics.filter((topic) => topic.status === "planned").length}</div><div className="metric-caption good">원고 공정 전달 가능</div></div>
      </section>
      <section className="panel channel-dictionary">
        <div className="panel-header"><div><h2>채널 탐색 사전</h2><p>A–L 입구 언어로 시장을 넓히되, 채널 승인에는 반복 근거를 남깁니다.</p></div><span>{ENTRY_CATEGORIES.length}개 분류</span></div>
        <div>{ENTRY_CATEGORIES.map(([letter, name, description]) => <article key={letter}><b>{letter}</b><span><strong>{name}</strong><small>{description}</small></span></article>)}</div>
      </section>
      <section className="panel content-data-table">
        <div className="panel-header"><div><h2>추적 채널</h2><p>채널 URL·운영 주체·대표 형식을 함께 관리합니다.</p></div><button className="ghost-button" onClick={() => setChannelOpen(true)}><Plus size={14} /> 직접 추가</button></div>
        <div className="content-table-head"><span>채널</span><span>분류</span><span>운영 주체</span><span>기본 형식</span><span>상태</span><span /></div>
        {channels.map((channel) => <div className="content-table-row" key={channel.id}><span><strong>{channel.title}</strong><small>{channel.description || "승인 근거 미입력"}</small></span><span>{meta(channel, "category", "미분류")}</span><span>{meta(channel, "ownerGroup", "미입력")}</span><span>{meta(channel, "defaultFormat", "해설")}</span><span className="status-pill status-active">추적 중</span><span>{channel.source_url ? <a href={channel.source_url} target="_blank" rel="noreferrer" aria-label={`${channel.title} 열기`}><ExternalLink size={14} /></a> : null}</span></div>)}
        {!channels.length ? <div className="compact-empty"><Youtube size={24} /><strong>아직 추적 채널이 없습니다.</strong><span>캡처의 채널 사전 기준으로 첫 관찰 채널을 등록하세요.</span></div> : null}
      </section>
    </> : null}

    {tab === "discovery" ? <>
      <section className="panel discovery-console">
        <div><span className="eyebrow">YouTube Data API</span><h2>터진 영상 발굴</h2><p>키워드별 조회 상위 영상을 불러오고, 사람이 근거 영상을 골라 틈새 판정에 보냅니다.</p></div>
        <div className="market-search"><Search size={17} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runSearch(); }} placeholder="예: 직장인 강점 찾기, 퇴사 후 불안" /><button className="primary-button" disabled={busy} onClick={runSearch}>{busy ? "탐색 중…" : "영상 탐색"}</button></div>
        <div className="procedure-chips"><span>조회 상위순</span><span>한국 지역</span><span>사람이 근거 채택</span><span>자동 기획 금지</span></div>
      </section>
      {results.length ? <section className="outlier-result-grid">{results.map((item) => {
        const saved = outliers.some((record) => meta(record, "youtubeId", "") === item.id);
        const engagement = item.viewCount ? (item.likeCount + item.commentCount) / item.viewCount * 100 : 0;
        return <article className="panel outlier-result" key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><span className="outlier-thumb" style={{ backgroundImage: `url(${item.thumbnail})` }}><i><Eye size={13} /> {compactNumber(item.viewCount)}</i></span></a><div><small>{item.channelTitle}</small><h3>{item.title}</h3><div><span>조회 {item.viewCount.toLocaleString("ko-KR")}</span><span>반응 {engagement.toFixed(1)}%</span></div><button className={saved ? "secondary-button" : "primary-button"} disabled={busy || saved} onClick={() => saveOutlier(item)}><Star size={14} /> {saved ? "근거 저장됨" : "틈새 근거로 저장"}</button></div></article>;
      })}</section> : <div className="panel compact-empty discovery-empty"><Radar size={28} /><strong>키워드로 시장 영상을 탐색하세요.</strong><span>검색 결과는 저장하기 전까지 운영 데이터에 들어가지 않습니다.</span></div>}
      <section className="panel content-data-table search-history-table"><div className="panel-header"><div><h2>탐색 이력</h2><p>같은 키워드의 반복 탐색과 결과 규모를 확인합니다.</p></div></div><div className="content-table-head"><span>키워드</span><span>결과</span><span>최고 조회</span><span>실행 시각</span></div>{searches.slice(0, 12).map((search) => <div className="content-table-row" key={search.id}><span><strong>{meta(search, "query", search.title)}</strong></span><span>{Number(meta(search, "resultCount", 0))}개</span><span>{compactNumber(Number(meta(search, "topViewCount", 0)))}</span><span>{new Date(meta(search, "searchedAt", search.created_at)).toLocaleString("ko-KR")}</span></div>)}</section>
    </> : null}

    {tab === "niches" ? <>
      <section className="niche-summary-grid">
        <div className="panel"><Flag size={17} /><span><strong>{topics.filter((item) => item.status === "planned").length}</strong><small>기획으로 넘기기</small></span></div>
        <div className="panel"><Eye size={17} /><span><strong>{topics.filter((item) => item.status === "review").length}</strong><small>더 지켜보기</small></span></div>
        <div className="panel"><Target size={17} /><span><strong>{outliers.length}</strong><small>단일 근거 영상</small></span></div>
        <div className="panel"><FileText size={17} /><span><strong>{plans.length}</strong><small>정본 기획안</small></span></div>
      </section>
      <section className="content-planning-layout">
        <aside className="panel source-list niche-list"><div className="panel-header"><div><h2>틈새 후보</h2><p>결정과 작업 폴더 사이 대기열</p></div></div>{topics.map((topic) => <button className={selected?.id === topic.id ? "active" : ""} key={topic.id} onClick={() => setSelectedId(topic.id)}><span><strong>{topic.title}</strong><small>{topic.stage || "판정 전"} · 근거 {topic.source_url ? "있음" : "미입력"}</small></span><ArrowRight size={14} /></button>)}{!topics.length ? <div className="list-empty">틈새 후보를 추가하거나 탐색 결과를 저장하세요.</div> : null}</aside>
        <article className="panel planning-detail niche-detail">{selected ? <>
          <header><div><span className={`status-pill status-${selected.status}`}>{selected.stage || "판정 전"}</span><h2>{selected.title}</h2><p>{selected.description}</p></div><button className="primary-button" disabled={busy} onClick={makePlan}><Sparkles size={14} /> 정본으로 후보 만들기</button></header>
          <dl className="planning-facts"><div><dt>대표 시청자</dt><dd>{meta(selected, "audience", "미입력")}</dd></div><div><dt>검색 입구 언어</dt><dd>{meta(selected, "entryLanguage", "미입력")}</dd></div><div><dt>콘텐츠 위계</dt><dd>{meta(selected, "hierarchy", "미정")}</dd></div><div><dt>시장 근거</dt><dd>{meta(selected, "evidence", selected.source_url || "미입력")}</dd></div></dl>
          <section className="niche-decision-bar"><div><strong>사람 판정</strong><small>AI는 근거와 후보를 제안하고, 이 결정은 사람이 저장합니다.</small></div><button className="ghost-button" disabled={busy} onClick={() => decideTopic("blocked")}>보류</button><button className="secondary-button" disabled={busy} onClick={() => decideTopic("review")}>더 지켜보기</button><button className="primary-button" disabled={busy} onClick={() => decideTopic("planned")}><Check size={14} /> 기획으로 넘기기</button></section>
          {candidates.length ? <div className="planning-candidates"><h3>제목·썸네일 출발 후보</h3>{candidates.map((candidate, index) => <article className={candidate.picked ? "picked" : ""} key={`${String(candidate.title)}-${index}`}><div><strong>{String(candidate.title ?? "제목 후보")}</strong><p>{String(candidate.thumbnailCopy ?? "")}</p><small>{String(candidate.narrative ?? candidate.evidence ?? "")}</small></div><button className="ghost-button" onClick={() => pickCandidate(index)}>{candidate.picked ? "★ 채택됨" : "☆ 채택"}</button></article>)}</div> : <div className="list-empty"><Sparkles size={20} /> 정본 실행 후 제목·썸네일 후보와 다음 공정 HANDOFF가 표시됩니다.</div>}
          {String(planResult.handoff ?? "") ? <section className="handoff-box"><span>다음에 할 일 · 넘길 말</span><p>{String(planResult.handoff)}</p></section> : null}
        </> : <div className="compact-empty"><Target size={24} /><strong>판정할 틈새를 선택하세요.</strong></div>}</article>
      </section>
    </> : null}

    {channelOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setChannelOpen(false)}><form className="record-drawer" onSubmit={addChannel} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">관찰 채널</span><h2>추적 채널 추가</h2></div><button type="button" className="icon-button" onClick={() => setChannelOpen(false)}><X size={18} /></button></div><label><span>YouTube 채널 URL · @핸들 · 채널 ID</span><div className="channel-verify-row"><input value={channelInput} onChange={(event) => { setChannelInput(event.target.value); setVerifiedChannel(null); }} required placeholder="https://www.youtube.com/@…" /><button type="button" className="secondary-button" disabled={busy} onClick={verifyChannel}><Search size={14} /> 채널 확인</button></div></label>{verifiedChannel ? <section className="verified-channel"><span style={{ backgroundImage: `url(${verifiedChannel.thumbnail})` }} /><div><strong>{verifiedChannel.title}</strong><small>{verifiedChannel.handle} · 구독자 {verifiedChannel.subscribers.toLocaleString("ko-KR")} · 영상 {verifiedChannel.videos.toLocaleString("ko-KR")}</small><p>{verifiedChannel.description || "채널 설명 없음"}</p></div><Check size={17} /></section> : <div className="inline-alert warning"><CircleAlert size={15} /> 이름 검색으로 추측하지 않습니다. 채널 URL 또는 @핸들로 정확한 채널을 먼저 확인하세요.</div>}<div className="form-grid"><label><span>입구 분류</span><select name="category">{ENTRY_CATEGORIES.map(([letter, name]) => <option value={`${letter}. ${name}`} key={letter}>{letter}. {name}</option>)}</select></label><label><span>대표 형식</span><select name="format"><option>해설</option><option>인터뷰</option><option>강의</option><option>브이로그</option><option>사례 분석</option></select></label></div><label><span>운영 주체</span><input name="ownerGroup" placeholder="개인·회사·미디어명" /></label><label><span>승인 근거</span><textarea name="reason" rows={4} placeholder="왜 계속 볼 채널인지, 반복해서 확인할 신호" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setChannelOpen(false)}>취소</button><button className="primary-button" disabled={busy || !verifiedChannel}>추적 채널 저장</button></div></form></div> : null}
    {topicOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setTopicOpen(false)}><form className="record-drawer" onSubmit={addTopic} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">틈새 입력</span><h2>새 주제 후보</h2></div><button type="button" className="icon-button" onClick={() => setTopicOpen(false)}><X size={18} /></button></div><label><span>틈새·주제</span><input name="title" required /></label><label><span>시청자가 겪는 현상·문제</span><textarea name="problem" required rows={4} /></label><div className="form-grid"><label><span>대표 시청자</span><input name="audience" /></label><label><span>콘텐츠 위계</span><select name="hierarchy"><option>유입형</option><option>전환형</option><option>판매형</option></select></label></div><label><span>검색되는 입구 언어</span><input name="entryLanguage" /></label><div className="form-grid"><label><span>채널명</span><input name="channel" /></label><label><span>브랜드</span><input name="brand" defaultValue="브랜디액션" /></label></div><label><span>근거·수치</span><textarea name="evidence" rows={3} /></label><label><span>근거 영상 URL</span><input type="url" name="sourceUrl" /></label><label><span>키워드</span><input name="keywords" placeholder="쉼표로 구분" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setTopicOpen(false)}>취소</button><button className="primary-button" disabled={busy}>틈새 후보 저장</button></div></form></div> : null}
  </>;
}
