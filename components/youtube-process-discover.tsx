"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest, createRecord, listAllRecordsOfType, resolveYoutubeChannel, type YoutubeChannelIdentity } from "@/lib/api-client";
import { contentOrigin } from "@/lib/content-origin";
import type { OsRecord } from "@/lib/record-types";
import { ageLabel, compactCount, DISCOVER_CATEGORIES, NICHE_RATIO, nicheThemes, type DiscoverVideo } from "@/lib/youtube-process/discover";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";

type View = "search" | "saved" | "channels";
type Pick = { category: string } | { q: string };
const meta = <T,>(record: OsRecord, key: string, fallback: T) => (record.metadata?.[key] ?? fallback) as T;
const newVideoHref = (video: DiscoverVideo) => `/content/plan?project=new&view=topic&ref=${encodeURIComponent(video.url)}&refTitle=${encodeURIComponent(`${video.title} · ${video.channelTitle}`)}`;
/** A saved or channel-found video record in the shape of a search result. */
const asVideo = (record: OsRecord): DiscoverVideo => ({
  id: meta(record, "youtubeId", record.id), title: record.title, channelTitle: meta(record, "channelTitle", ""), viewCount: Number(meta(record, "views", record.metric_current ?? 0)),
  subscribers: meta<number | null>(record, "subscribers", null), viewSubscriberRatio: meta<number | null>(record, "viewSubscriberRatio", null), durationSeconds: Number(meta(record, "durationSeconds", 0)),
  publishedAt: meta<string | null>(record, "publishedAt", null), thumbnail: meta(record, "thumbnail", ""), url: record.source_url ?? "",
});
const DEMO: DiscoverVideo[] = [
  ["단점이 오히려 강점이 되는 사람들의 공통점", "예시 채널 A", 412_000, 38_000], ["내 강점 찾는 법, 이 질문 하나면 됩니다", "예시 채널 B", 128_000, 9_100],
  ["직장인 강점 진단, 해보고 놀란 이유", "예시 채널 C", 96_000, 210_000], ["재능이 없다고 느낄 때 보는 영상", "예시 채널 D", 53_000, 12_000],
  ["단점을 고치지 마세요 · 강점 심리학", "예시 채널 E", 230_000, 41_000], ["잘하는 것과 좋아하는 것 사이에서", "예시 채널 F", 18_000, 160_000],
].map(([title, channelTitle, viewCount, subscribers], index) => ({ id: `demo-${index}`, title: String(title), channelTitle: String(channelTitle), viewCount: Number(viewCount), subscribers: Number(subscribers),
  viewSubscriberRatio: Math.round(Number(viewCount) / Number(subscribers) * 100) / 100, durationSeconds: 600 + index * 60, publishedAt: new Date(Date.now() - (index + 1) * 20 * 86_400_000).toISOString(),
  thumbnail: "", url: "https://www.youtube.com/", category: "A" }));

/** 주제 찾기 (owner request 2026-10-21): a category or keyword brings reference videos at once; the niche topics are the words shared by videos watched beyond their channel's subscribers. */
export function YoutubeDiscoverScreen() {
  const { accessToken, demo, profile } = useSession();
  const [pick, setPick] = useState<Pick>({ category: "all" });
  const [query, setQuery] = useState("");
  const [days, setDays] = useState("365");
  const [format, setFormat] = useState<"long" | "short" | "any">("long");
  const [sort, setSort] = useState<"ratio" | "views" | "recent">("ratio");
  const [view, setView] = useState<View>("search");
  const [theme, setTheme] = useState("");
  const [result, setResult] = useState<{ items: DiscoverVideo[]; at: string; cached: boolean } | null>(null);
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const search = useCallback(async (refresh = false) => {
    setTheme(""); setError("");
    if (demo) { setResult({ items: DEMO, at: new Date().toISOString(), cached: false }); return; }
    if (!accessToken) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ days, ...("q" in pick ? { q: pick.q } : { category: pick.category }), ...(refresh ? { refresh: "1" } : {}) });
      setResult(await apiRequest<{ items: DiscoverVideo[]; at: string; cached: boolean }>(`/api/v1/content/youtube/discover?${params}`, { token: accessToken }));
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }, [accessToken, demo, days, pick]);
  useEffect(() => { void search(); }, [search]);
  const loadRecords = useCallback(async () => {
    if (demo || !accessToken) return;
    try { setRecords((await listAllRecordsOfType(accessToken, "content_topic")).filter(row => contentOrigin(row) !== "test" && row.metadata?.workflow !== "youtube_v1")); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const channels = records.filter(row => meta<string>(row, "studioKind", "") === "channel");
  const saved = records.filter(row => meta<string>(row, "studioKind", "") === "outlier" && !["tracked_channel", "rising_channel"].includes(meta<string>(row, "discoverySource", "")));
  const tracked = records.filter(row => ["tracked_channel", "rising_channel"].includes(meta<string>(row, "discoverySource", "")));
  const savedIds = new Set(saved.map(row => meta<string>(row, "youtubeId", "")));
  const base = view === "search" ? result?.items ?? [] : (view === "saved" ? saved : tracked).map(asVideo);
  // Saved and channel-found videos may not know their length (0): they stay in every format.
  const listed = base.filter(video => format === "any" || !video.durationSeconds || (format === "long" ? video.durationSeconds >= 240 : video.durationSeconds < 240));
  const themes = nicheThemes(listed);
  const nicheCount = listed.filter(video => (video.viewSubscriberRatio ?? 0) >= NICHE_RATIO).length;
  const picked = themes.find(item => item.word === theme);
  const shown = (picked ? listed.filter(video => picked.ids.includes(video.id)) : listed).slice().sort((a, b) => sort === "views" ? b.viewCount - a.viewCount
    : sort === "recent" ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") : (b.viewSubscriberRatio ?? -1) - (a.viewSubscriberRatio ?? -1));

  const save = async (video: DiscoverVideo) => {
    if (!accessToken || savedIds.has(video.id)) return;
    setSaving(video.id); setError("");
    try {
      await createRecord(accessToken, { recordType: "content_topic", title: video.title, description: `${video.channelTitle}에서 찾은 레퍼런스 영상`, status: "review", priority: "normal",
        stage: "레퍼런스", team: profile?.team || "콘텐츠", sourceUrl: video.url, metricCurrent: video.viewCount, metricUnit: "조회", tags: ["레퍼런스"],
        metadata: { studioKind: "outlier", discoverySource: "keyword", baseline: null, youtubeId: video.id, channelTitle: video.channelTitle, thumbnail: video.thumbnail, publishedAt: video.publishedAt,
          views: video.viewCount, subscribers: video.subscribers, viewSubscriberRatio: video.viewSubscriberRatio, durationSeconds: video.durationSeconds, query: "q" in pick ? pick.q : pick.category } });
      await loadRecords();
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(""); }
  };
  const label = "q" in pick ? `“${pick.q}”` : pick.category === "all" ? "전체 분류" : DISCOVER_CATEGORIES.find(([letter]) => letter === pick.category)?.[1] ?? "";
  const hoursAgo = result?.at ? Math.floor((Date.now() - Date.parse(result.at)) / 3_600_000) : 0;

  return <>
    <div className="yp-mv-head"><h1 className="page-title" data-ui="page-title">주제 찾기</h1><span style={{ flex: 1 }} /><Link className="yp-btn" href="/content/projects">← 내 영상</Link></div>
    <form className="yp-disc-search" onSubmit={event => { event.preventDefault(); if (query.trim().length >= 2) { setView("search"); setPick({ q: query.trim() }); } }}>
      <Search size={16} className="yp-i" aria-hidden="true" /><input className="yp-in" value={query} onChange={event => setQuery(event.target.value)} placeholder="키워드로 찾기 · 예) 직장인 강점 찾기" aria-label="키워드로 찾기" />
      <button type="submit" className="yp-btn yp-pri" disabled={query.trim().length < 2}>찾기</button></form>
    <div className="yp-chips" role="group" aria-label="분류">
      <button type="button" className={`yp-chip${"category" in pick && pick.category === "all" ? " yp-on" : ""}`} onClick={() => { setView("search"); setPick({ category: "all" }); }}>전체</button>
      {DISCOVER_CATEGORIES.map(([letter, name]) => <button key={letter} type="button" className={`yp-chip${"category" in pick && pick.category === letter ? " yp-on" : ""}`} onClick={() => { setView("search"); setPick({ category: letter }); }}>{letter} {name}</button>)}
    </div>
    <div className="yp-disc-bar">
      <div className="yp-seg2" role="tablist" aria-label="보기">{([["search", `유튜브 · ${label}`], ["saved", `저장한 영상 ${saved.length}`], ["channels", `매일 보는 채널 ${tracked.length}`]] as const).map(([key, text]) =>
        <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "yp-on" : ""} onClick={() => { setView(key); setTheme(""); }}>{text}</button>)}</div>
      <span style={{ flex: 1 }} />
      {view === "search" ? <select className="yp-in yp-w-auto" aria-label="기간" value={days} onChange={event => setDays(event.target.value)}><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="365">최근 1년</option><option value="all">전체 기간</option></select> : null}
      <select className="yp-in yp-w-auto" aria-label="길이" value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="long">롱폼 (4분 이상)</option><option value="short">숏폼 (4분 미만)</option><option value="any">길이 전체</option></select>
      <select className="yp-in yp-w-auto" aria-label="정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="ratio">구독자 대비 조회수 높은 순</option><option value="views">조회수 높은 순</option><option value="recent">최신순</option></select>
    </div>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    {view === "search" && result && !busy ? <p className="yp-hint" style={{ margin: "0 0 10px" }}>{result.cached ? `${hoursAgo ? `${hoursAgo}시간` : "조금"} 전에 찾아 둔 결과예요.` : "방금 유튜브에서 찾았어요."}
      {!demo ? <> <button type="button" className="yp-lnk" onClick={() => void search(true)}><RefreshCw size={12} aria-hidden="true" /> 다시 찾기</button></> : null}</p> : null}

    <section className="yp-card" style={{ marginBottom: 12 }}><div className="yp-card-h"><b>틈새 주제</b><span className="yp-gq">구독자보다 조회수가 높은 영상 {nicheCount}개에서 겹치는 말 · 누르면 그 영상만 보여요</span></div>
      <div className="yp-card-b">{busy ? <p className="yp-hint" style={{ margin: 0 }}>찾는 중이에요…</p> : themes.length ? <div className="yp-chips">{themes.map(item =>
        <button key={item.word} type="button" className={`yp-chip${theme === item.word ? " yp-on" : ""}`} onClick={() => setTheme(theme === item.word ? "" : item.word)}>{item.word} · 영상 {item.count}개 · 평균 {item.avgRatio}배</button>)}</div>
        : <p className="yp-hint" style={{ margin: 0 }}>{nicheCount ? "겹치는 말이 아직 없어요. 분류를 넓히거나 기간을 늘려 보세요." : "구독자보다 조회수가 높은 영상이 없어요. 기간을 늘리거나 다른 분류를 눌러 보세요."}</p>}</div></section>

    <div className="yp-fld-h"><b>레퍼런스 영상 {busy ? "" : `${shown.length}개`}</b>{picked ? <button type="button" className="yp-chip yp-on" onClick={() => setTheme("")}>{picked.word} <X size={12} aria-hidden="true" /></button> : null}
      <span className="yp-gq">‘구독자의 N배’가 1배를 넘으면 채널 크기보다 주제가 끌어온 조회예요</span></div>
    {busy ? <p className="yp-pempty" role="status">유튜브에서 {label} 영상을 찾는 중이에요… {"category" in pick && pick.category === "all" ? "(전체는 10초쯤 걸려요)" : ""}</p>
      : shown.length ? <div className="yp-ref-grid">{shown.map(video => <article key={video.id} className="yp-ref">
        <a className="yp-ref-thumb" href={video.url} target="_blank" rel="noreferrer" style={video.thumbnail ? { backgroundImage: `url(${video.thumbnail})` } : undefined} aria-label={`${video.title} 유튜브에서 보기`}>
          {video.durationSeconds ? <span>{Math.floor(video.durationSeconds / 60)}:{String(video.durationSeconds % 60).padStart(2, "0")}</span> : null}</a>
        <div className="yp-ref-b">
          <a className="yp-ref-t" href={video.url} target="_blank" rel="noreferrer" title={video.title}>{video.title}</a>
          <span className="yp-muted">{video.channelTitle}{video.subscribers ? ` · 구독자 ${compactCount(video.subscribers)}` : ""}</span>
          <span className="yp-muted">조회 {compactCount(video.viewCount)}{video.publishedAt ? ` · ${ageLabel(video.publishedAt)}` : ""}</span>
          {video.viewSubscriberRatio !== null ? <span className={`yp-tag${video.viewSubscriberRatio >= NICHE_RATIO ? " yp-ok" : ""}`}>구독자의 {Math.round(video.viewSubscriberRatio * 10) / 10}배</span> : null}
          <div className="yp-row-btns"><Link className="yp-btn yp-sm yp-pri" href={newVideoHref(video)}>이 영상으로 새 영상</Link>
            {view !== "saved" ? <button type="button" className="yp-btn yp-sm" disabled={demo || savedIds.has(video.id) || saving === video.id} onClick={() => void save(video)}>{savedIds.has(video.id) ? "저장됨" : saving === video.id ? "저장 중…" : "저장"}</button> : null}</div>
        </div></article>)}</div>
      : <p className="yp-pempty">{view === "saved" ? "저장한 영상이 없어요. 마음에 드는 영상에서 [저장]을 눌러요." : view === "channels" ? "매일 보는 채널에서 눈에 띄는 영상이 생기면 여기에 모여요. 아래에서 채널을 추가해요." : "찾은 영상이 없어요. 기간을 늘리거나 다른 분류를 눌러 보세요."}</p>}

    <ChannelManager channels={channels} onAdded={loadRecords} demo={demo} token={accessToken} team={profile?.team || "콘텐츠"} />
  </>;
}

/** 매일 보는 채널: the list and adding one by its exact address (never guessed from a name). */
function ChannelManager({ channels, onAdded, demo, token, team }: { channels: OsRecord[]; onAdded: () => Promise<void>; demo: boolean; token: string | null; team: string }) {
  const [input, setInput] = useState("");
  const [category, setCategory] = useState("A. 강점·재능");
  const [found, setFound] = useState<YoutubeChannelIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verify = async () => {
    if (input.trim().length < 2) return;
    setBusy(true); setError(""); setFound(null);
    try { setFound((await resolveYoutubeChannel(token, input.trim())).channel); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const add = async () => {
    if (!found || !token) return;
    setBusy(true); setError("");
    try {
      await createRecord(token, { recordType: "content_topic", title: found.title, description: "", status: "active", priority: "normal", stage: "관찰 채널", brand: "브랜디액션", team, sourceUrl: found.url,
        tags: ["관찰채널", category], metadata: { studioKind: "channel", category, region: "KR", channelId: found.id, handle: found.handle, thumbnail: found.thumbnail, subscribers: found.subscribers,
          videoCount: found.videos, totalViews: found.views, verifiedAt: new Date().toISOString() } });
      setInput(""); setFound(null); await onAdded();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <details className="yp-more-fields" style={{ marginTop: 16 }}><summary>매일 보는 채널 관리 ({channels.length}개)</summary>
    <div className="yp-card"><div className="yp-card-b">
      {channels.length ? <ul className="yp-hist" style={{ marginBottom: 10 }}>{channels.map(channel => <li key={channel.id} style={{ alignItems: "center" }}><span style={{ flex: 1, minWidth: 0 }}><b>{channel.title}</b> <span className="yp-muted">{String(channel.metadata?.category ?? "분류 없음")}{channel.metadata?.subscribers ? ` · 구독자 ${compactCount(Number(channel.metadata.subscribers))}` : ""}</span></span>
        {channel.source_url ? <a className="yp-ib" href={channel.source_url} target="_blank" rel="noreferrer" aria-label={`${channel.title} 열기`}><ExternalLink size={14} /></a> : null}</li>)}</ul> : <p className="yp-hint" style={{ marginTop: 0 }}>아직 매일 보는 채널이 없어요.</p>}
      <div className="yp-savebar"><input className="yp-in" style={{ flex: 1, minWidth: 200 }} value={input} onChange={event => { setInput(event.target.value); setFound(null); }} placeholder="채널 주소 또는 @핸들" aria-label="채널 주소" />
        <button type="button" className="yp-btn" disabled={demo || busy || input.trim().length < 2} onClick={() => void verify()}>채널 확인</button></div>
      {found ? <div className="yp-savebar" style={{ marginTop: 8 }}><span style={{ flex: 1, minWidth: 0 }}><b>{found.title}</b> <span className="yp-muted">{found.handle} · 구독자 {compactCount(found.subscribers)}</span></span>
        <select className="yp-in yp-w-auto" aria-label="분류" value={category} onChange={event => setCategory(event.target.value)}>{DISCOVER_CATEGORIES.map(([letter, name]) => <option key={letter} value={`${letter}. ${name}`}>{letter}. {name}</option>)}</select>
        <button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void add()}><Plus size={14} /> 추가</button></div> : null}
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    </div></div></details>;
}
