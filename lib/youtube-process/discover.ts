// 유튜브 공정 v1 주제 찾기 (owner decision 2026-10-21: the original 기획실 concept, brandyaction-bot/studio.py):
// 1 채널 모으기 → 2 터진 영상 (a channel's own normal views ×2) → 3 틈새 (the same title formula at 2 · 3 different channels).
import { median } from "../youtube-outliers.ts";

// The words follow the 2026-10-21 target (BRANDYACTION 핵심 컨텍스트): people who have worked and are weighing a move, a role or
// their own line of work. Shop promotion, investing, fitness and study tips are not this audience's topics, so no word invites them.
export const DISCOVER_CATEGORIES = [
  ["A", "강점·재능", ["강점 찾기", "재능 찾는 법", "잘하는 일 찾기"]],
  ["B", "성향·기질", ["성향에 맞는 직업", "MBTI 직업", "내향인 직장"]],
  ["C", "직업·커리어", ["이직 고민", "직무 전환", "커리어 고민"]],
  ["D", "나만의 업", ["나만의 업", "평생 직업", "좋아하는 일로 먹고살기"]],
  ["E", "실행·습관", ["실행력", "작심삼일", "미루는 습관"]],
  ["F", "일터 관계", ["직장 인간관계", "회사 사람 스트레스", "상사 갈등"]],
  ["G", "마음·감정", ["번아웃", "자존감", "일하기 싫을 때"]],
  ["H", "먹고살 일", ["먹고살 걱정", "직장인 미래 불안", "오래 할 수 있는 일"]],
  ["I", "자기이해", ["자기이해", "나를 알아가는 법", "진짜 원하는 것 찾기"]],
  ["J", "일과 삶", ["워라밸", "일과 삶의 균형", "직장인 지칠 때"]],
  ["K", "리더십", ["리더십", "팀장 고민", "관리자 스트레스"]],
  ["L", "라이프 전환", ["퇴사 고민", "인생 전환기", "진로 고민"]],
] as const;
export type DiscoverLetter = (typeof DISCOVER_CATEGORIES)[number][0];
export const DISCOVER_LETTERS = DISCOVER_CATEGORIES.map(([letter]) => letter) as DiscoverLetter[];

/** One YouTube search per category: its words joined with OR ("강점 찾기"|재능|"잘하는 것"). */
export function categoryQuery(letter: DiscoverLetter) {
  const words = DISCOVER_CATEGORIES.find(([key]) => key === letter)![2];
  return words.map(word => word.includes(" ") ? `"${word}"` : word).join("|");
}

/** The 기획실 rules (사용법 › 틈새 판정 기준), plus its channel rule that a normal of under 1,000 views makes the multiple meaningless. */
export const BREAKOUT = { ratio: 2, minViews: 5_000, minMedian: 1_000, minSeconds: 240 } as const;

export interface DiscoverVideo {
  id: string; title: string; channelId: string; channelTitle: string; viewCount: number; subscribers: number | null; durationSeconds: number;
  publishedAt: string | null; thumbnail: string; url: string;
  /** The channel's normal: median views of its recent long uploads; ratio = views ÷ that. */
  median: number | null; ratio: number | null; viewSubscriberRatio: number | null; query?: string;
}
export interface DiscoverChannel { id: string; title: string; url: string; subscribers: number | null; median: number | null; breakouts: number; best: number | null; top: DiscoverVideo[] }

const SHORTS = /#shorts|쇼츠|재업로드|재업\b|reupload/i;
export const isLongform = (video: { durationSeconds: number; title: string; live?: boolean }) => video.durationSeconds >= BREAKOUT.minSeconds && !video.live && !SHORTS.test(video.title);
/** A channel's normal views: the median of its long uploads (5 or more), else unknown. */
export function channelNormal(uploads: { views: number; durationSeconds: number; title: string; live?: boolean }[]) {
  const views = uploads.filter(isLongform).map(video => video.views);
  return views.length >= 5 ? median(views) : null;
}
export const isBreakout = (video: Pick<DiscoverVideo, "ratio" | "viewCount" | "median" | "durationSeconds" | "title">) =>
  (video.ratio ?? 0) >= BREAKOUT.ratio && video.viewCount >= BREAKOUT.minViews && (video.median ?? 0) >= BREAKOUT.minMedian && isLongform(video);
/** Searches count Korean titles only (기획실: 블라인드 검색은 한글만); channels someone added count in any language. */
export const KOREAN = /[가-힣]/;
/** Background sound, music and playlists answer no topic: they are left out of the references. */
export const NOT_A_TOPIC = /asmr|백색\s*소음|빗소리|플레이\s*리스트|playlist|\bmusic\b|\bbgm\b|노동요|수면\s*음악|명상\s*음악/i;

export type NicheStage = "confirmed" | "watch" | "solo";
/** Different channels using the same title formula: 3 = 확인된 주제, 2 = 지켜보는 것, 1 = 혼자 터뜨린 것. */
export const nicheStage = (channels: number): NicheStage => channels >= 3 ? "confirmed" : channels === 2 ? "watch" : "solo";
export type NicheVideo = Pick<DiscoverVideo, "id" | "title" | "channelId" | "channelTitle" | "viewCount" | "median" | "ratio" | "thumbnail" | "url">;
export type NicheDecision = "plan" | "watch" | "drop";
/** One 틈새: a title formula the staff AI found, the 터진 영상 behind it, and the team's decision. */
export interface NicheCluster {
  id: string; title: string; formula: string; desire: string; rule: string; videos: NicheVideo[]; channels: number; stage: NicheStage;
  decision?: { value: NicheDecision; at: string; by: string };
}

/** 8:00:01 for videos past an hour, 26:27 below. */
export function durationLabel(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
export const compactCount = (value: number) => new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const ratioLabel = (ratio: number) => ratio >= 10 ? `${Math.round(ratio)}배` : `${Math.round(ratio * 10) / 10}배`;
/** "3개월 전" style age of a video. */
export function ageLabel(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
  return days < 1 ? "오늘" : days < 30 ? `${days}일 전` : days < 365 ? `${Math.floor(days / 30)}개월 전` : `${Math.floor(days / 365)}년 전`;
}

/**
 * 패키징 레퍼런스 (the 기획실 썸네일 레퍼런스 검색, 패키징 정본 작업 순서 1): views 50,000 or more, nothing live, ranked by
 * views ÷ subscribers (hidden subscribers last), then views; 40 kept. Under a minute counts as shorts, as in the 기획실.
 */
export const PACKAGING_MIN_VIEWS = 50_000;
export interface PackagingRef { id: string; title: string; channel: string; views: number; subscribers: number | null; ratio: number | null; short: boolean; thumbnail: string; url: string }
export function rankPackagingRefs(videos: { id: string; title: string; channel: string; views: number; subscribers: number | null; seconds: number; live: boolean }[]): PackagingRef[] {
  return videos.filter(video => video.id && !video.live && video.views >= PACKAGING_MIN_VIEWS)
    .map(video => ({ id: video.id, title: video.title, channel: video.channel, views: video.views, subscribers: video.subscribers,
      ratio: video.subscribers ? Math.round(video.views / video.subscribers * 10) / 10 : null, short: video.seconds < 60,
      thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${video.id}` }))
    .sort((a, b) => Number(a.ratio === null) - Number(b.ratio === null) || (b.ratio ?? 0) - (a.ratio ?? 0) || b.views - a.views)
    .slice(0, 40);
}
/** The video's own format first (기획실 롱폼만 · 쇼츠만); every format only when that one has fewer than three. */
export const packagingPick = (refs: PackagingRef[], short: boolean) => { const same = refs.filter(ref => ref.short === short); return same.length >= 3 ? same : refs; };
