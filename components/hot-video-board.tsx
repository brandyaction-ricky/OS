"use client";

import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Star, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, type YoutubeMarketItem } from "@/lib/api-client";
import { HOT_VIDEO_CATEGORIES, hotVideoFormat, scoreLabel, seoulDate, type HotVideoItem } from "@/lib/hot-video-board";

type Board = {
  metadata: {
    collectedAt?: string;
    failure?: string | null;
    items?: HotVideoItem[];
    quota?: { dailyUnits?: number; detail?: string };
  };
};
export type HotVideoEvidence = Pick<HotVideoItem,
  "category" | "categoryName" | "performance" | "performanceState" | "performanceReason" | "performanceSampleCount" |
  "exposureVelocity" | "exposureAcceleration" | "momentumState" | "contribution" | "snapshots"
>;
type Props = {
  token: string | null;
  savedIds: Set<string>;
  onSave: (item: YoutubeMarketItem, evidence: HotVideoEvidence) => Promise<unknown>;
};

const compactNumber = (value: number | null) => value == null ? "집계 중" : new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const score = (value: number | null) => value == null ? "—" : value.toFixed(2);
const moveDate = (date: string, days: number) => {
  const next = new Date(`${date}T12:00:00+09:00`);
  next.setUTCDate(next.getUTCDate() + days);
  return seoulDate(next);
};

export function HotVideoBoard({ token, savedIds, onSave }: Props) {
  const today = seoulDate();
  const [region, setRegion] = useState("KR");
  const [format, setFormat] = useState<"long" | "short">("long");
  const [date, setDate] = useState(today);
  const [sort, setSort] = useState<"performance" | "exposureVelocity" | "views">("performance");
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showOther, setShowOther] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError(""); setBoard(null);
    try {
      const result = await apiRequest<{ board: Board | null }>(`/api/v1/youtube/hot-videos?date=${date}&region=${region}`, { token });
      setBoard(result.board);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "핫 비디오 보드를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [date, region, token]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => (board?.metadata.items ?? [])
    .filter((item) => format === "long" ? ["long", "reference"].includes(hotVideoFormat(item.durationSeconds)) : hotVideoFormat(item.durationSeconds) === "short")
    .sort((a, b) => Number(b[sort] ?? -1) - Number(a[sort] ?? -1)), [board, format, sort]);
  const groups = [...HOT_VIDEO_CATEGORIES.map(([id, name]) => ({ id, name })), { id: "other", name: "기타" }]
    .map((category) => ({ ...category, items: items.filter((item) => item.category === category.id) }))
    .filter((group) => group.items.length && (group.id !== "other" || showOther));

  const retry = async () => {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/v1/youtube/hot-videos", { token, method: "POST" });
      setDate(today);
      if (date === today) await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "다시 수집하지 못했습니다.");
      setBusy(false);
    }
  };

  const save = async (item: HotVideoItem) => onSave({
    id: item.id,
    title: item.title,
    channelTitle: item.channelTitle,
    publishedAt: item.publishedAt,
    thumbnail: item.thumbnail,
    viewCount: item.views,
    likeCount: item.likes,
    commentCount: item.comments,
    durationSeconds: item.durationSeconds,
    subscribers: item.subscribers,
    viewSubscriberRatio: item.contribution,
    url: `https://www.youtube.com/watch?v=${item.id}`,
  }, {
    category: item.category,
    categoryName: item.categoryName,
    performance: item.performance,
    performanceState: item.performanceState,
    performanceReason: item.performanceReason,
    performanceSampleCount: item.performanceSampleCount,
    exposureVelocity: item.exposureVelocity,
    exposureAcceleration: item.exposureAcceleration,
    momentumState: item.momentumState,
    contribution: item.contribution,
    snapshots: item.snapshots,
  });

  return <section className="panel hot-video-board">
    <header className="panel-header"><div><span className="eyebrow">Daily Hot Board</span><h2>지금 반응이 터지는 영상</h2><p>검색어 없이 국가별 인기·최근 상승 영상을 매일 모아 A–L 주제로 분류합니다.</p></div><span>{items.length}개</span></header>
    <div className="hot-video-toolbar">
      <label>지역<select value={region} onChange={(event) => setRegion(event.target.value)}><option value="KR">한국</option><option value="US">미국</option><option value="JP" disabled>일본 · 다음 단계</option></select></label>
      <label>형식<select value={format} onChange={(event) => setFormat(event.target.value as "long" | "short")}><option value="long">롱폼 · 4분 이상</option><option value="short">쇼츠 · 60초 이하</option></select></label>
      <label>기준일<span className="hot-video-date"><button type="button" className="icon-button" aria-label="전일" onClick={() => setDate((value) => moveDate(value, -1))}><ChevronLeft size={14} /></button><input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /><button type="button" className="icon-button" aria-label="다음 날" disabled={date >= today} onClick={() => setDate((value) => moveDate(value, 1))}><ChevronRight size={14} /></button></span></label>
      <label>정렬<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="performance">채널 대비 성과</option><option value="exposureVelocity">노출 속도</option><option value="views">조회수</option></select></label>
      {date === today ? <button className="secondary-button" disabled={busy} onClick={() => void retry()}><RefreshCw size={14} /> {busy ? "확인 중…" : "오늘 다시 수집"}</button> : <button className="secondary-button" onClick={() => setDate(today)}>오늘로 이동</button>}
    </div>
    {error || board?.metadata.failure ? <div className="inline-alert danger"><span>수집 실패 · {error || board?.metadata.failure}</span>{date === today ? <button className="ghost-button" onClick={() => void retry()}>재시도</button> : null}</div> : null}
    {!busy && !board ? <div className="compact-empty"><TrendingUp size={24} /><strong>{date} {region} 보드가 아직 없습니다.</strong><span>오늘 수집을 실행하거나 예약 수집이 끝난 뒤 표시됩니다.</span></div> : null}
    {board ? <>
      <p className="hot-video-meta">수집 {board.metadata.collectedAt ? new Date(board.metadata.collectedAt).toLocaleString("ko-KR") : "시간 미확인"} · 예상 일일 할당량 최대 {board.metadata.quota?.dailyUnits ?? "—"}단위</p>
      <div className="hot-video-groups">{groups.map((group) => <section key={group.id}><h3><b>{group.id === "other" ? "—" : group.id}</b>{group.name}<span>{group.items.length}</span></h3><div>{group.items.map((item) => {
        const reference = hotVideoFormat(item.durationSeconds) === "reference";
        return <article className="hot-video-card" key={item.id}>
          <a className="hot-video-thumb" href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer" style={{ backgroundImage: `url(${item.thumbnail})` }}><span>{reference ? "참고 · " : ""}{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span></a>
          <div><small>{item.channelTitle} · 구독 {compactNumber(item.subscribers)}</small><h4>{item.translatedTitle || item.title}</h4><p>조회 {compactNumber(item.views)} · {item.streakDays > 1 ? `${item.streakDays}일 연속` : "오늘 진입"}</p><dl><div title={item.performanceReason}><dt>성과</dt><dd>{scoreLabel(item.performance)} <b>{score(item.performance)}×</b><small>표본 {item.performanceSampleCount}/20</small></dd></div><div><dt>노출 속도</dt><dd>{scoreLabel(item.exposureVelocity, [100, 1_000, 5_000, 20_000])} <b>{compactNumber(item.exposureVelocity)}/h</b><small>{item.momentumState === "measured" ? "3회 측정" : `집계 ${item.snapshots.length}/3`}</small></dd></div><div><dt>기여도</dt><dd>{scoreLabel(item.contribution, [0.01, 0.05, 0.2, 0.5])} <b>{score(item.contribution)}</b></dd></div></dl><footer><button className={savedIds.has(item.id) ? "secondary-button" : "primary-button"} disabled={savedIds.has(item.id) || reference} onClick={() => void save(item)}><Star size={13} /> {savedIds.has(item.id) ? "근거 저장됨" : reference ? "참고 영상" : "틈새 근거 저장"}</button><a href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer" aria-label="YouTube에서 보기"><ExternalLink size={14} /></a></footer></div>
        </article>;
      })}</div></section>)}</div>
      {items.some((item) => item.category === "other") ? <button className="ghost-button hot-video-other" onClick={() => setShowOther((value) => !value)}>{showOther ? "기타 접기" : `기타 ${items.filter((item) => item.category === "other").length}개 보기`}</button> : null}
    </> : null}
  </section>;
}
