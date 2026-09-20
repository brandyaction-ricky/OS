import { median, youtubeMomentum, type YoutubeViewSnapshot } from "@/lib/youtube-outliers";

export const HOT_VIDEO_REGIONS = ["KR", "US"] as const;
export type HotVideoRegion = (typeof HOT_VIDEO_REGIONS)[number];
export type HotVideoFormat = "long" | "short";

export const HOT_VIDEO_CATEGORIES = [
  ["A", "강점·재능", ["강점", "재능", "talent", "strength"]],
  ["B", "성향·기질", ["성격", "기질", "personality", "temperament"]],
  ["C", "직업·커리어", ["직업", "커리어", "이직", "career", "job"]],
  ["D", "사업·창업", ["사업", "창업", "수익화", "business", "startup"]],
  ["E", "생산성", ["생산성", "실행력", "습관", "시간 관리", "productivity", "habit"]],
  ["F", "관계·소통", ["관계", "소통", "갈등", "말하기", "relationship", "communication"]],
  ["G", "마음·감정", ["불안", "자존감", "회복", "감정", "anxiety", "emotion"]],
  ["H", "돈·경제", ["돈", "경제", "재테크", "소비", "finance", "money"]],
  ["I", "공부·성장", ["공부", "학습", "독서", "성장", "learning", "study"]],
  ["J", "건강·생활", ["건강", "수면", "운동", "루틴", "health", "sleep"]],
  ["K", "리더십", ["리더", "조직", "관리", "leadership", "management"]],
  ["L", "라이프 전환", ["퇴사", "전환기", "인생 설계", "life change", "transition"]],
] as const;

export type HotVideoItem = {
  id: string; title: string; translatedTitle: string; channelId: string; channelTitle: string;
  thumbnail: string; publishedAt: string; observedAt: string; durationSeconds: number; views: number; subscribers: number | null;
  category: string; categoryName: string; performance: number | null; exposureVelocity: number | null;
  contribution: number | null; momentumState: "insufficient" | "measured"; streakDays: number;
};

export function classifyHotVideo(text: string) {
  const normalized = text.toLocaleLowerCase("ko-KR");
  for (const [id, name, keywords] of HOT_VIDEO_CATEGORIES) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return { id, name };
  }
  return { id: "other", name: "기타" };
}

export function hotVideoFormat(durationSeconds: number): HotVideoFormat | "reference" | "excluded" {
  if (durationSeconds <= 60) return "short";
  if (durationSeconds < 240) return "reference";
  return "long";
}

export function scoreLabel(value: number | null, thresholds = [0.5, 1, 2, 4]) {
  if (value == null || !Number.isFinite(value)) return "집계 중";
  if (value < thresholds[0]) return "Worst";
  if (value < thresholds[1]) return "Bad";
  if (value < thresholds[2]) return "Normal";
  if (value < thresholds[3]) return "Good";
  return "Great";
}

export function buildHotVideoScores(input: { views: number; subscribers: number | null; recentChannelViews: number[]; snapshots: YoutubeViewSnapshot[] }) {
  const baseline = median(input.recentChannelViews);
  const momentum = youtubeMomentum(input.snapshots);
  return {
    performance: baseline && baseline > 0 ? input.views / baseline : null,
    contribution: input.subscribers && input.subscribers > 0 ? input.views / input.subscribers : null,
    exposureVelocity: momentum.velocity,
    momentumState: momentum.state,
  };
}

export function hotVideoQuotaEstimate(regionCount = 2) {
  return { dailyUnits: regionCount * 101, detail: `지역 ${regionCount}곳 × (mostPopular 1 + search 100)` };
}
