// 유튜브 공정 v1 주제 찾기 (owner decision 2026-10-21: the original 기획실 concept, brandyaction-bot/studio.py):
// 1 채널 모으기 → 2 터진 영상 (a channel's own normal views ×2) → 3 틈새 (the same title formula at 2 · 3 different channels).
import { median } from "../youtube-outliers.ts";

export const DISCOVER_CATEGORIES = [
  ["A", "강점·재능", ["강점 찾기", "재능", "잘하는 것"]],
  ["B", "성향·기질", ["성격 유형", "기질", "나다운 삶"]],
  ["C", "직업·커리어", ["이직", "직무 선택", "커리어 고민"]],
  ["D", "사업·창업", ["1인 사업", "창업", "수익화"]],
  ["E", "생산성", ["실행력", "습관 만들기", "시간 관리"]],
  ["F", "관계·소통", ["인간관계", "갈등 해결", "말 잘하는 법"]],
  ["G", "마음·감정", ["불안", "자존감", "번아웃 회복"]],
  ["H", "돈·경제", ["재테크", "소비 습관", "경제적 자유"]],
  ["I", "공부·성장", ["공부법", "독서", "자기계발"]],
  ["J", "건강·생활", ["수면 습관", "운동 루틴", "건강한 생활 습관"]],
  ["K", "리더십", ["리더십", "팀 관리", "리더의 판단"]],
  ["L", "라이프 전환", ["퇴사", "인생 전환기", "인생 설계"]],
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
