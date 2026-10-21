// 유튜브 공정 v1 주제 찾기 (owner request 2026-10-21): a category or keyword brings reference videos, and the videos watched
// far beyond their channel's subscribers show the niche topics they share.
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

export interface DiscoverVideo { id: string; title: string; channelTitle: string; viewCount: number; subscribers: number | null; viewSubscriberRatio: number | null; durationSeconds: number; publishedAt: string | null; thumbnail: string; url: string; category?: string }
/** Views per subscriber at or above this make a niche candidate (watched beyond the channel's own audience). */
export const NICHE_RATIO = 1;

// ponytail: Korean titles split on spaces with common endings trimmed, not a morphological analyser; good enough to surface
// repeated topic words. Swap for the staff AI if the themes read wrong.
const ENDINGS = ["으로", "에서", "까지", "에게", "한테", "처럼", "보다", "이란", "이라", "하는", "했던", "하면", "해도", "에도", "으면", "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만", "요"];
const STOP = new Set(["방법", "이유", "진짜", "정말", "모든", "그냥", "가장", "사람", "사람들", "우리", "당신", "여러분", "지금", "이것", "그것", "무엇", "어떻게", "왜", "있는", "없는", "되는", "하는", "합니다", "입니다", "하세요", "영상", "공개", "추천", "ft", "the", "and", "for", "you", "with", "shorts", "쇼츠"]);
export function titleWords(title: string) {
  const words = title.toLocaleLowerCase("ko-KR").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => {
    for (const end of ENDINGS) if (word.length > end.length + 1 && word.endsWith(end)) return word.slice(0, -end.length);
    return word;
  });
  return [...new Set(words.filter(word => word.length >= 2 && !STOP.has(word) && !/^\d+$/.test(word)))];
}

export interface NicheTheme { word: string; count: number; avgRatio: number; ids: string[] }
/** Words shared by at least two niche videos, most shared first (then the higher average views per subscriber). */
export function nicheThemes(videos: DiscoverVideo[], minRatio = NICHE_RATIO, limit = 12): NicheTheme[] {
  const byWord = new Map<string, { ids: string[]; ratios: number[] }>();
  for (const video of videos) {
    if ((video.viewSubscriberRatio ?? 0) < minRatio) continue;
    for (const word of titleWords(video.title)) {
      const entry = byWord.get(word) ?? { ids: [], ratios: [] };
      entry.ids.push(video.id); entry.ratios.push(video.viewSubscriberRatio!);
      byWord.set(word, entry);
    }
  }
  return [...byWord.entries()].filter(([, entry]) => entry.ids.length >= 2)
    .map(([word, entry]) => ({ word, count: entry.ids.length, avgRatio: Math.round(entry.ratios.reduce((a, b) => a + b, 0) / entry.ratios.length * 10) / 10, ids: entry.ids }))
    .sort((a, b) => b.count - a.count || b.avgRatio - a.avgRatio).slice(0, limit);
}

/** Background sound, music and playlists answer no topic: they are left out of the references. */
export const NOT_A_TOPIC = /asmr|백색\s*소음|빗소리|플레이\s*리스트|playlist|\bmusic\b|\bbgm\b|노동요|수면\s*음악|명상\s*음악/i;
/** 8:00:01 for videos past an hour, 26:27 below. */
export function durationLabel(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const compactCount = (value: number) => new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
/** "3개월 전" style age of a video. */
export function ageLabel(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
  return days < 1 ? "오늘" : days < 30 ? `${days}일 전` : days < 365 ? `${Math.floor(days / 30)}개월 전` : `${Math.floor(days / 365)}년 전`;
}
