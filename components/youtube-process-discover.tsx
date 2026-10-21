"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { apiRequest, archiveRecord, createRecord, listAllRecordsOfType, resolveYoutubeChannel, type YoutubeChannelIdentity } from "@/lib/api-client";
import { contentOrigin } from "@/lib/content-origin";
import type { OsRecord } from "@/lib/record-types";
import {
  ageLabel, BREAKOUT, compactCount, DISCOVER_CATEGORIES, durationLabel, isBreakout, ratioLabel,
  type DiscoverChannel, type DiscoverVideo, type NicheCluster, type NicheDecision, type NicheVideo,
} from "@/lib/youtube-process/discover";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";

// 주제 찾기 (owner decision 2026-10-21: the original 기획실 concept): ① 채널 모으기 → ② 터진 영상 (a channel's own normal ×2)
// → ③ 틈새 (the same title formula at different channels: 3 = 확인된 주제, 2 = 지켜보는 것) → [기획으로 넘기기] makes a new video.
type Tab = "channels" | "breakouts" | "niche";
type Source = "found" | "tracked" | "kept";
type Query = { category: string } | { q: string };
type Found = { videos: DiscoverVideo[]; channels: DiscoverChannel[]; at: string; cached: boolean };
type Board = { boardId: string; clusters: NicheCluster[]; settled: NicheCluster[]; at: string | null; by: string | null; model: string | null; pool: number };
const meta = <T,>(record: OsRecord, key: string, fallback: T) => (record.metadata?.[key] ?? fallback) as T;
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const newVideoHref = (video: Pick<DiscoverVideo, "url" | "title" | "channelTitle">, extra?: { title: string; note: string }) => `/content/plan?project=new&view=topic&ref=${encodeURIComponent(video.url)}&refTitle=${encodeURIComponent(extra?.title ?? `${video.title} · ${video.channelTitle}`)}${extra ? `&title=${encodeURIComponent(extra.title)}&note=${encodeURIComponent(extra.note.slice(0, 600))}` : ""}`;
/** A kept or channel-found video record in the shape of a search result; 매일 보는 채널's outliers keep their baseline. */
const asVideo = (record: OsRecord): DiscoverVideo => {
  const baseline = meta<{ ratio?: unknown; medianViews?: unknown }>(record, "baseline", {}) ?? {};
  const viewCount = Number(meta(record, "views", record.metric_current ?? 0)); const subscribers = num(record.metadata?.subscribers);
  return { id: meta(record, "youtubeId", record.id), title: record.title, channelId: meta(record, "channelId", ""), channelTitle: meta(record, "channelTitle", ""), viewCount, subscribers,
    durationSeconds: Number(meta(record, "durationSeconds", 0)), publishedAt: meta<string | null>(record, "publishedAt", null), thumbnail: meta(record, "thumbnail", ""), url: record.source_url ?? "",
    median: num(record.metadata?.median) ?? num(baseline.medianViews), ratio: num(record.metadata?.ratio) ?? num(baseline.ratio),
    viewSubscriberRatio: num(record.metadata?.viewSubscriberRatio) ?? (subscribers ? Math.round(viewCount / subscribers * 100) / 100 : null) };
};
const categoryName = (letter?: string) => { const found = DISCOVER_CATEGORIES.find(([key]) => key === letter); return found ? `${found[0]}. ${found[1]}` : ""; };

const DEMO_VIDEOS: DiscoverVideo[] = ([
  ["단점이 오히려 강점이 되는 사람들의 공통점", "예시 채널 A", 412_000, 38_000, 61_000], ["내 강점 찾는 법, 이 질문 하나면 됩니다", "예시 채널 B", 128_000, 9_100, 22_000],
  ["직장인 강점 진단, 해보고 놀란 이유", "예시 채널 C", 96_000, 210_000, 31_000], ["재능이 없다고 느낄 때 보는 영상", "예시 채널 D", 53_000, 12_000, 40_000],
  ["단점을 고치지 마세요 · 강점 심리학", "예시 채널 E", 230_000, 41_000, 52_000], ["잘하는 것과 좋아하는 것 사이에서", "예시 채널 F", 18_000, 160_000, 9_000],
] as const).map(([title, channelTitle, viewCount, subscribers, median], index) => ({ id: `demo-${index}`, title, channelId: `demo-ch-${index}`, channelTitle, viewCount, subscribers,
  durationSeconds: 600 + index * 60, publishedAt: new Date(Date.now() - (index + 1) * 20 * 86_400_000).toISOString(), thumbnail: "", url: "https://www.youtube.com/", median,
  ratio: Math.round(viewCount / median * 10) / 10, viewSubscriberRatio: Math.round(viewCount / subscribers * 100) / 100, query: "A" }));
const DEMO_CHANNELS: DiscoverChannel[] = DEMO_VIDEOS.map(video => ({ id: video.channelId, title: video.channelTitle, url: "https://www.youtube.com/", subscribers: video.subscribers,
  median: video.median, breakouts: isBreakout(video) ? 2 : 0, best: isBreakout(video) ? video.ratio : null, top: isBreakout(video) ? [video] : [] }));
const DEMO_BOARD: Board = { boardId: "00000000-0000-5000-a000-000000000000", pool: 6, at: new Date().toISOString(), by: "예시", model: "예시", settled: [], clusters: [
  { id: "demo-n1", title: "단점이 강점으로 뒤집히는 순간", formula: "[흔한 단점]이 오히려 [강점]이 되는 이유", desire: "내 단점도 쓸모 있다는 확인", rule: "우리 강점 테마 하나를 골라 그 테마의 '단점처럼 보이는 모습'으로 시작한다",
    videos: DEMO_VIDEOS.slice(0, 5).filter((_, index) => index !== 3), channels: 3, stage: "confirmed" },
  { id: "demo-n2", title: "질문 하나로 찾는 내 재능", formula: "[질문 하나]면 [내 재능]이 보입니다", desire: "복잡한 검사 없이 바로 알기", rule: "강점 진단 문항 중 하나를 질문으로 꺼낸다", videos: DEMO_VIDEOS.slice(1, 4), channels: 2, stage: "watch" },
  { id: "demo-n3", title: "좋아하는 일 vs 잘하는 일", formula: "[A]와 [B] 사이에서 고민될 때", desire: "선택의 기준", rule: "강점과 흥미의 차이로 풀어낸다", videos: DEMO_VIDEOS.slice(5), channels: 1, stage: "solo" },
] };
const TAB_HINT: Record<Tab, string> = {
  channels: "분류를 누르면 그 분야 채널이 나와요. 평소 조회수와 터진 영상 수를 보고 매일 볼 채널을 목록에 넣어요.",
  breakouts: `자기 채널 평소 조회수의 ${BREAKOUT.ratio}배 넘게 나온 영상이에요 (${compactCount(BREAKOUT.minViews)}회 이상 · 4분 이상). 틈새로 묶을 영상은 [틈새 재료로 담기]를 눌러요.`,
  niche: "같은 제목 공식이 서로 다른 채널 3곳에서 터지면 확인된 주제, 2곳이면 지켜보는 것이에요. 정하면 [기획으로 넘기기]로 새 영상이 돼요.",
};

export function YoutubeDiscoverScreen() {
  const { accessToken, demo, profile } = useSession();
  const [tab, setTab] = useState<Tab>("breakouts");
  const [source, setSource] = useState<Source>("found");
  const [pick, setPick] = useState<Query>({ category: "all" });
  const [query, setQuery] = useState("");
  const [days, setDays] = useState("365");
  const [onlyBreakouts, setOnlyBreakouts] = useState(true);
  const [sort, setSort] = useState<"ratio" | "views" | "recent">("ratio");
  const [found, setFound] = useState<Found | null>(null);
  const [records, setRecords] = useState<OsRecord[]>([]);
  const [openNiches, setOpenNiches] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const team = profile?.team || "콘텐츠";

  const search = useCallback(async (refresh = false) => {
    setError("");
    if (demo) { setFound({ videos: DEMO_VIDEOS, channels: DEMO_CHANNELS, at: new Date().toISOString(), cached: false }); return; }
    if (!accessToken) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ days, ...("q" in pick ? { q: pick.q } : { category: pick.category }), ...(refresh ? { refresh: "1" } : {}) });
      setFound(await apiRequest<Found>(`/api/v1/content/youtube/discover?${params}`, { token: accessToken }));
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }, [accessToken, demo, days, pick]);
  useEffect(() => { void search(); }, [search]);
  const loadRecords = useCallback(async () => {
    if (demo || !accessToken) return;
    try { setRecords((await listAllRecordsOfType(accessToken, "content_topic")).filter(row => contentOrigin(row) !== "test" && row.metadata?.workflow !== "youtube_v1")); }
    catch (reason) { setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const kind = (row: OsRecord) => meta<string>(row, "studioKind", ""); const from = (row: OsRecord) => meta<string>(row, "discoverySource", "");
  const channels = records.filter(row => kind(row) === "channel");
  const kept = records.filter(row => kind(row) === "outlier" && from(row) === "keyword");
  const tracked = records.filter(row => kind(row) === "outlier" && ["tracked_channel", "rising_channel"].includes(from(row)));
  const keptIds = new Set(kept.map(row => meta<string>(row, "youtubeId", "")));
  const trackedChannelIds = new Set(channels.map(row => meta<string>(row, "channelId", "")));
  const foundBreakouts = (found?.videos ?? []).filter(isBreakout);
  const base = source === "found" ? (onlyBreakouts ? foundBreakouts : found?.videos ?? []) : (source === "kept" ? kept : tracked).map(asVideo);
  const shown = base.slice().sort((a, b) => sort === "views" ? b.viewCount - a.viewCount : sort === "recent" ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") : (b.ratio ?? -1) - (a.ratio ?? -1));
  const candidates = (found?.channels ?? []).filter(channel => (channel.median ?? 0) >= BREAKOUT.minMedian);

  const keep = async (video: DiscoverVideo) => {
    if (!accessToken || keptIds.has(video.id)) return;
    setSaving(video.id); setError("");
    try {
      await createRecord(accessToken, { recordType: "content_topic", title: video.title, description: `${video.channelTitle}에서 찾은 터진 영상`, status: "review", priority: "normal",
        stage: "레퍼런스", team, sourceUrl: video.url, metricCurrent: video.viewCount, metricUnit: "조회", tags: ["레퍼런스", "틈새재료"],
        metadata: { studioKind: "outlier", discoverySource: "keyword", baseline: null, youtubeId: video.id, channelId: video.channelId, channelTitle: video.channelTitle, thumbnail: video.thumbnail,
          publishedAt: video.publishedAt, views: video.viewCount, subscribers: video.subscribers, median: video.median, ratio: video.ratio, viewSubscriberRatio: video.viewSubscriberRatio,
          durationSeconds: video.durationSeconds, query: video.query ?? ("q" in pick ? pick.q : pick.category) } });
      await loadRecords();
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(""); }
  };
  const track = async (channel: DiscoverChannel) => {
    if (!accessToken || trackedChannelIds.has(channel.id)) return;
    setSaving(channel.id); setError("");
    const letter = "category" in pick && pick.category !== "all" ? pick.category : found?.videos.find(video => video.channelId === channel.id)?.query;
    const category = categoryName(letter) || "검색으로 찾음";
    try {
      await createRecord(accessToken, { recordType: "content_topic", title: channel.title, description: "", status: "active", priority: "normal", stage: "관찰 채널", brand: "브랜디액션", team, sourceUrl: channel.url,
        tags: ["관찰채널", category], metadata: { studioKind: "channel", category, region: "KR", channelId: channel.id, subscribers: channel.subscribers, median: channel.median, verifiedAt: new Date().toISOString() } });
      await loadRecords();
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(""); }
  };
  const label = "q" in pick ? `“${pick.q}”` : pick.category === "all" ? "전체 분류" : DISCOVER_CATEGORIES.find(([letter]) => letter === pick.category)?.[1] ?? "";
  const hoursAgo = found?.at ? Math.floor((Date.now() - Date.parse(found.at)) / 3_600_000) : 0;
  const searchable = tab !== "niche";

  return <>
    <div className="yp-mv-head"><h1 className="page-title" data-ui="page-title">주제 찾기</h1><span style={{ flex: 1 }} /><Link className="yp-btn" href="/content/projects">← 내 영상</Link></div>
    <div className="yp-seg2 yp-disc-tabs" role="tablist" aria-label="주제 찾기 단계">{([["channels", `① 채널 모으기 ${channels.length}`], ["breakouts", `② 터진 영상 ${busy ? "" : foundBreakouts.length + tracked.length}`], ["niche", `③ 틈새 ${openNiches}`]] as const).map(([key, text]) =>
      <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "yp-on" : ""} onClick={() => setTab(key)}>{text}</button>)}</div>
    <p className="yp-hint" style={{ margin: "8px 0 12px" }}>{TAB_HINT[tab]}</p>
    {searchable ? <>
      <form className="yp-disc-search" onSubmit={event => { event.preventDefault(); if (query.trim().length >= 2) { setSource("found"); setPick({ q: query.trim() }); } }}>
        <Search size={16} className="yp-i" aria-hidden="true" /><input className="yp-in" value={query} onChange={event => setQuery(event.target.value)} placeholder="키워드로 찾기 · 예) 직장인 강점 찾기" aria-label="키워드로 찾기" />
        <button type="submit" className="yp-btn yp-pri" disabled={query.trim().length < 2}>찾기</button></form>
      <div className="yp-chips" role="group" aria-label="분류">
        <button type="button" className={`yp-chip${"category" in pick && pick.category === "all" ? " yp-on" : ""}`} onClick={() => { setSource("found"); setPick({ category: "all" }); }}>전체</button>
        {DISCOVER_CATEGORIES.map(([letter, name]) => <button key={letter} type="button" className={`yp-chip${"category" in pick && pick.category === letter ? " yp-on" : ""}`} onClick={() => { setSource("found"); setPick({ category: letter }); }}>{letter} {name}</button>)}
      </div>
      <div className="yp-disc-bar">
        {found && !busy ? <span className="yp-hint" style={{ margin: 0 }}>{found.cached ? `${hoursAgo ? `${hoursAgo}시간` : "조금"} 전에 찾아 둔 결과예요.` : "방금 유튜브에서 찾았어요."}
          {!demo ? <> <button type="button" className="yp-lnk" onClick={() => void search(true)}><RefreshCw size={12} aria-hidden="true" /> 다시 찾기</button></> : null}</span> : null}
        <span style={{ flex: 1 }} />
        <select className="yp-in yp-w-auto" aria-label="기간" value={days} onChange={event => setDays(event.target.value)}><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="365">최근 1년</option><option value="all">전체 기간</option></select>
      </div>
    </> : null}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}

    {tab === "channels" ? <>
      <div className="yp-fld-h"><b>{label} 채널 {busy ? "" : `${candidates.length}곳`}</b><span className="yp-gq">터진 영상이 많은 순 · 평소 {compactCount(BREAKOUT.minMedian)}회 미만 채널은 배수가 의미 없어 뺐어요</span></div>
      {busy ? <p className="yp-pempty" role="status">유튜브에서 {label} 채널을 찾는 중이에요… {"category" in pick && pick.category === "all" ? "(전체는 20초쯤 걸려요)" : ""}</p>
        : candidates.length ? <div className="yp-dch-list">{candidates.map(channel => <article key={channel.id} className="yp-dch">
          <div className="yp-dch-h">
            <span style={{ flex: 1, minWidth: 0 }}><a href={channel.url} target="_blank" rel="noreferrer"><b>{channel.title}</b></a><br />
              <span className="yp-muted">{channel.subscribers ? `구독자 ${compactCount(channel.subscribers)} · ` : ""}평소 {compactCount(channel.median ?? 0)}회</span></span>
            {channel.breakouts ? <span className="yp-tag yp-ok">터진 영상 {channel.breakouts}개 · 최고 {ratioLabel(channel.best ?? 0)}</span> : <span className="yp-tag">터진 영상 없음</span>}
            <button type="button" className="yp-btn yp-sm" disabled={demo || trackedChannelIds.has(channel.id) || saving === channel.id} onClick={() => void track(channel)}>{trackedChannelIds.has(channel.id) ? "목록에 있음" : saving === channel.id ? "넣는 중…" : <><Plus size={13} aria-hidden="true" /> 목록에 넣기</>}</button>
          </div>
          {channel.top.length ? <div className="yp-dch-v">{channel.top.map(video => <a key={video.id} className="yp-ref-thumb" href={video.url} target="_blank" rel="noreferrer" title={video.title}
            style={{ backgroundImage: `url(${video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`})` }} aria-label={`${video.title} 유튜브에서 보기`}><span>{ratioLabel(video.ratio ?? 0)}</span></a>)}</div> : null}
        </article>)}</div>
        : <p className="yp-pempty">찾은 채널이 없어요. 기간을 늘리거나 다른 분류를 눌러 보세요.</p>}
      <ChannelManager channels={channels} onChanged={loadRecords} demo={demo} token={accessToken} team={team} />
    </> : null}

    {tab === "breakouts" ? <>
      <div className="yp-disc-bar" style={{ marginTop: 0 }}>
        <div className="yp-seg2" role="tablist" aria-label="어디서 찾은 영상">{([["found", `찾은 영상 · ${label}`], ["tracked", `매일 보는 채널 ${tracked.length}`], ["kept", `담아 둔 영상 ${kept.length}`]] as const).map(([key, text]) =>
          <button key={key} type="button" role="tab" aria-selected={source === key} className={source === key ? "yp-on" : ""} onClick={() => setSource(key)}>{text}</button>)}</div>
        <span style={{ flex: 1 }} />
        {source === "found" ? <label className="yp-check"><input type="checkbox" checked={onlyBreakouts} onChange={event => setOnlyBreakouts(event.target.checked)} /> 평소의 {BREAKOUT.ratio}배 넘는 것만</label> : null}
        <select className="yp-in yp-w-auto" aria-label="정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="ratio">평소 대비 높은 순</option><option value="views">조회수 높은 순</option><option value="recent">최신순</option></select>
      </div>
      {source === "found" && busy ? <p className="yp-pempty" role="status">유튜브에서 {label} 영상을 찾고 채널마다 평소 조회수를 재는 중이에요… {"category" in pick && pick.category === "all" ? "(전체는 20초쯤 걸려요)" : ""}</p>
        : shown.length ? <div className="yp-ref-grid">{shown.map(video => <article key={video.id} className="yp-ref">
          <a className="yp-ref-thumb" href={video.url} target="_blank" rel="noreferrer" style={video.thumbnail ? { backgroundImage: `url(${video.thumbnail})` } : undefined} aria-label={`${video.title} 유튜브에서 보기`}>
            {video.durationSeconds ? <span>{durationLabel(video.durationSeconds)}</span> : null}</a>
          <div className="yp-ref-b">
            <a className="yp-ref-t" href={video.url} target="_blank" rel="noreferrer" title={video.title}>{video.title}</a>
            <span className="yp-muted">{video.channelTitle}{video.subscribers ? ` · 구독자 ${compactCount(video.subscribers)}` : ""}</span>
            <span className="yp-muted">조회 {compactCount(video.viewCount)}{video.publishedAt ? ` · ${ageLabel(video.publishedAt)}` : ""}</span>
            <span className="yp-row-btns" style={{ marginTop: 0 }}>
              {video.ratio !== null ? <span className={`yp-tag${video.ratio >= BREAKOUT.ratio ? " yp-ok" : ""}`}>평소의 {ratioLabel(video.ratio)}{video.median ? ` (평소 ${compactCount(video.median)}회)` : ""}</span> : null}
              {video.viewSubscriberRatio !== null ? <span className="yp-tag">구독자의 {ratioLabel(video.viewSubscriberRatio)}</span> : null}</span>
            <div className="yp-row-btns">
              {source !== "kept" ? <button type="button" className="yp-btn yp-sm" disabled={demo || keptIds.has(video.id) || saving === video.id} onClick={() => void keep(video)}>{keptIds.has(video.id) ? "담김" : saving === video.id ? "담는 중…" : "틈새 재료로 담기"}</button> : null}
              <Link className="yp-btn yp-sm yp-pri" href={newVideoHref(video)}>이 영상으로 새 영상</Link></div>
          </div></article>)}</div>
        : <p className="yp-pempty">{source === "kept" ? "담아 둔 영상이 없어요. 찾은 영상에서 [틈새 재료로 담기]를 눌러요." : source === "tracked" ? "매일 보는 채널에서 평소보다 크게 나온 영상이 생기면 여기에 모여요. ① 채널 모으기에서 채널을 넣어요."
          : onlyBreakouts && found?.videos.length ? `찾은 영상 ${found.videos.length}개 중 평소의 ${BREAKOUT.ratio}배를 넘은 영상이 없어요. 기간을 늘리거나 다른 분류를 눌러 보세요.` : "찾은 영상이 없어요. 기간을 늘리거나 다른 분류를 눌러 보세요."}</p>}
    </> : null}

    <div hidden={tab !== "niche"}><NicheBoard token={accessToken} demo={demo} profile={profile} onCount={setOpenNiches} /></div>
  </>;
}

const STAGE_TAG = { confirmed: ["확인된 주제", " yp-ok"], watch: ["아직 2곳", " yp-warn"], solo: ["1곳뿐", ""] } as const;
const DECISION: Record<NicheDecision, string> = { plan: "기획으로 넘김", watch: "더 지켜보기", drop: "안 하기" };
const nicheNote = (niche: NicheCluster) => `틈새: ${niche.title}\n제목 공식: ${niche.formula}\n시청자가 원하는 것: ${niche.desire}\n바꿔 쓰는 법: ${niche.rule}\n근거: 서로 다른 채널 ${niche.channels}곳 · 영상 ${niche.videos.length}편`;

/** ③ 틈새: the staff member's AI groups 터진 영상 by title formula; the team decides each group. */
function NicheBoard({ token, demo, profile, onCount }: { token: string | null; demo: boolean; profile: ReturnType<typeof useSession>["profile"]; onCount: (count: number) => void }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) { setBoard(DEMO_BOARD); return; }
    if (!token) return;
    try { setBoard(await apiRequest<Board>("/api/v1/content/youtube/niches", { token })); } catch (reason) { setError(errorMessage(reason)); }
  }, [token, demo]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onCount(board?.clusters.filter(niche => !niche.decision && niche.stage !== "solo").length ?? 0); }, [board, onCount]);
  const page = useMemo(() => ({ demo, accessToken: token, profile, bundle: board ? { project: { id: board.boardId, version: 0 } } : null }), [demo, token, profile, board]);
  const job = useStaffJob(page, "niche", load);
  const decide = async (niche: NicheCluster, decision: NicheDecision | null) => {
    setError("");
    if (decision === "plan" && niche.videos[0]) {
      if (!demo) { setBusy(niche.id); try { await apiRequest("/api/v1/content/youtube/niches", { method: "POST", token, body: JSON.stringify({ clusterId: niche.id, decision }) }); } catch (reason) { setError(errorMessage(reason)); setBusy(""); return; } }
      router.push(newVideoHref(niche.videos[0], { title: niche.title, note: nicheNote(niche) })); return;
    }
    if (demo) { setBoard(current => current && { ...current, clusters: current.clusters.map(row => row.id === niche.id ? { ...row, decision: decision ? { value: decision, at: new Date().toISOString(), by: "예시" } : undefined } : row) }); return; }
    setBusy(niche.id);
    try { const next = await apiRequest<Omit<Board, "pool">>("/api/v1/content/youtube/niches", { method: "POST", token, body: JSON.stringify({ clusterId: niche.id, decision }) }); setBoard(current => current && { ...current, ...next }); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  if (!board) return error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : <p className="yp-pempty" role="status">틈새 판을 불러오는 중이에요…</p>;
  const open = board.clusters.filter(niche => !niche.decision);
  const decided = [...board.clusters.filter(niche => niche.decision), ...board.settled];
  const sections = [["confirmed", "정해야 할 것", "서로 다른 채널 3곳 이상에서 같은 공식이 터졌어요"], ["watch", "지켜보는 것", "다른 채널 한 곳만 더 나오면 위로 올라와요"], ["solo", "혼자 터뜨린 것", "한 곳에서만 터졌어요 · 근거가 한 곳뿐이라는 걸 알고 정해요"]] as const;
  const card = (niche: NicheCluster) => <details key={niche.id} className="yp-niche">
    <summary><span className="yp-niche-t">{niche.title}</span>
      <span className="yp-row-btns" style={{ marginTop: 0 }}><span className={`yp-tag${STAGE_TAG[niche.stage][1]}`}>{STAGE_TAG[niche.stage][0]}</span>{niche.decision ? <span className="yp-tag yp-acc">{DECISION[niche.decision.value]}</span> : null}
        <span className="yp-muted">서로 다른 채널 {niche.channels}곳 · 영상 {niche.videos.length}편</span></span>
      <span className="yp-muted">{niche.formula}</span></summary>
    <div className="yp-niche-b">
      <dl className="yp-kv" style={{ gridTemplateColumns: "120px minmax(0,1fr)", fontSize: 13 }}><dt>제목 공식</dt><dd>{niche.formula}</dd><dt>시청자가 원하는 것</dt><dd>{niche.desire}</dd><dt>바꿔 쓰는 법</dt><dd>{niche.rule}</dd></dl>
      <div className="yp-dch-v">{niche.videos.slice(0, 8).map((video: NicheVideo) => <a key={video.id} className="yp-ref-thumb" href={video.url} target="_blank" rel="noreferrer" title={`${video.title} · ${video.channelTitle}`}
        style={{ backgroundImage: `url(${video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`})` }} aria-label={`${video.title} 유튜브에서 보기`}>{video.ratio ? <span>{ratioLabel(video.ratio)}</span> : null}</a>)}</div>
      <ul className="yp-hist" style={{ margin: "8px 0" }}>{niche.videos.map(video => <li key={video.id}><span style={{ flex: 1, minWidth: 0 }}><a href={video.url} target="_blank" rel="noreferrer">{video.title}</a> <span className="yp-muted">— {video.channelTitle} · 조회 {compactCount(video.viewCount)}{video.ratio ? ` · 평소의 ${ratioLabel(video.ratio)}` : ""}</span></span></li>)}</ul>
      {niche.decision ? <div className="yp-row-btns"><span className="yp-muted">{niche.decision.by} · {ageLabel(niche.decision.at)} {DECISION[niche.decision.value]}</span>
        {board.clusters.some(row => row.id === niche.id) ? <button type="button" className="yp-btn yp-sm" disabled={busy === niche.id} onClick={() => void decide(niche, null)}>되돌리기</button> : null}
        {niche.decision.value === "plan" && niche.videos[0] ? <Link className="yp-btn yp-sm" href={newVideoHref(niche.videos[0], { title: niche.title, note: nicheNote(niche) })}>새 영상 하나 더</Link> : null}</div>
        : <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm yp-pri" disabled={busy === niche.id} onClick={() => void decide(niche, "plan")}>기획으로 넘기기</button>
          <button type="button" className="yp-btn yp-sm" disabled={busy === niche.id} onClick={() => void decide(niche, "watch")}>더 지켜보기</button>
          <button type="button" className="yp-btn yp-sm" disabled={busy === niche.id} onClick={() => void decide(niche, "drop")}>안 하기</button></div>}
    </div></details>;
  return <>
    <section className="yp-card" style={{ marginBottom: 12 }}><div className="yp-card-b">
      <div className="yp-row-btns" style={{ marginTop: 0, alignItems: "center" }}>
        <span style={{ flex: 1, minWidth: 220 }}><b>묶을 재료: 터진 영상 {board.pool}개</b><br /><span className="yp-muted">담아 둔 영상 · 매일 보는 채널 · 지금까지 찾은 터진 영상{board.at ? ` · 마지막 묶음 ${ageLabel(board.at)}${board.by ? ` (${board.by})` : ""}` : ""}</span></span>
        <button type="button" className="yp-btn yp-pri" disabled={demo || board.pool < 3 || job.open} onClick={() => setSend(true)}><Sparkles size={14} aria-hidden="true" /> 내 AI로 틈새 묶기</button></div>
      <JobLine job={job} onRetry={() => setSend(true)} />
      {board.pool < 3 ? <p className="yp-hint" style={{ margin: "8px 0 0" }}>터진 영상이 3개 이상 모이면 묶을 수 있어요. ② 터진 영상에서 분류를 눌러 찾아요.</p> : null}
    </div></section>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    {sections.map(([stage, name, hint]) => { const list = open.filter(niche => niche.stage === stage); return <section key={stage} style={{ marginBottom: 16 }}>
      <div className="yp-fld-h"><b>{name} {list.length}</b><span className="yp-gq">{hint}</span></div>
      {list.length ? list.map(card) : <p className="yp-pempty" style={{ padding: "12px 0" }}>{board.at ? "없어요." : "아직 묶은 적이 없어요. [내 AI로 틈새 묶기]를 눌러요."}</p>}</section>; })}
    {decided.length ? <section><div className="yp-fld-h"><b>이미 정한 것 {decided.length}</b></div>{decided.map(card)}</section> : null}
    <SendDialog page={page} task="niche" open={send} onClose={() => setSend(false)} job={job} />
  </>;
}

/** 내 채널 목록: the channels the hourly check watches; add one by its exact address (never guessed from a name) or take one off. */
function ChannelManager({ channels, onChanged, demo, token, team }: { channels: OsRecord[]; onChanged: () => Promise<void>; demo: boolean; token: string | null; team: string }) {
  const [input, setInput] = useState("");
  const [category, setCategory] = useState(categoryName("A"));
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
      setInput(""); setFound(null); await onChanged();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const remove = async (channel: OsRecord) => {
    if (!token || !window.confirm(`${channel.title}을(를) 매일 보는 채널에서 뺄까요? 지금까지 모인 영상은 그대로 남아요.`)) return;
    setBusy(true); setError("");
    try { await archiveRecord(token, channel.id); await onChanged(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <section className="yp-card" style={{ marginTop: 16 }}><div className="yp-card-h"><b>매일 보는 채널 {channels.length}곳</b><span className="yp-gq">한 시간마다 새 영상을 재서 평소보다 크게 나온 영상을 ② 터진 영상에 모아요</span></div>
    <div className="yp-card-b">
      {channels.length ? <ul className="yp-hist" style={{ marginBottom: 10 }}>{channels.map(channel => <li key={channel.id} style={{ alignItems: "center" }}><span style={{ flex: 1, minWidth: 0 }}><b>{channel.title}</b> <span className="yp-muted">{String(channel.metadata?.category ?? "분류 없음")}{channel.metadata?.subscribers ? ` · 구독자 ${compactCount(Number(channel.metadata.subscribers))}` : ""}</span></span>
        {channel.source_url ? <a className="yp-ib" href={channel.source_url} target="_blank" rel="noreferrer" aria-label={`${channel.title} 열기`}><ExternalLink size={14} /></a> : null}
        <button type="button" className="yp-ib" disabled={demo || busy} aria-label={`${channel.title} 빼기`} onClick={() => void remove(channel)}><X size={14} /></button></li>)}</ul>
        : <p className="yp-hint" style={{ marginTop: 0 }}>아직 매일 보는 채널이 없어요. 위에서 [목록에 넣기]를 누르거나 주소로 넣어요.</p>}
      <div className="yp-savebar"><input className="yp-in" style={{ flex: 1, minWidth: 200 }} value={input} onChange={event => { setInput(event.target.value); setFound(null); }} placeholder="채널 주소 또는 @핸들로 넣기" aria-label="채널 주소" />
        <button type="button" className="yp-btn" disabled={demo || busy || input.trim().length < 2} onClick={() => void verify()}>채널 확인</button></div>
      {found ? <div className="yp-savebar" style={{ marginTop: 8 }}><span style={{ flex: 1, minWidth: 0 }}><b>{found.title}</b> <span className="yp-muted">{found.handle} · 구독자 {compactCount(found.subscribers)}</span></span>
        <select className="yp-in yp-w-auto" aria-label="분류" value={category} onChange={event => setCategory(event.target.value)}>{DISCOVER_CATEGORIES.map(([letter]) => <option key={letter} value={categoryName(letter)}>{categoryName(letter)}</option>)}</select>
        <button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void add()}><Plus size={14} /> 넣기</button></div> : null}
      {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    </div></section>;
}
