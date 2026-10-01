import {
  median,
  outlierBaseline,
  youtubeMomentum,
  type BaselineVideo,
  type YoutubeViewSnapshot,
} from "./youtube-outliers.ts";

export const HOT_VIDEO_REGIONS = ["KR", "US"] as const;
export const HOT_VIDEO_CANDIDATE_LIMIT = 12;
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
  id: string;
  title: string;
  translatedTitle: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
  observedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
  comments: number;
  subscribers: number | null;
  category: string;
  categoryName: string;
  performance: number | null;
  performanceBaselineViews: number | null;
  performanceState: "insufficient" | "measured" | "excluded";
  performanceReason: string;
  performanceSampleCount: number;
  exposureVelocity: number | null;
  exposureAcceleration: number | null;
  contribution: number | null;
  momentumState: "insufficient" | "measured";
  streakDays: number;
  snapshots: YoutubeViewSnapshot[];
};

export function seoulDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function classifyHotVideo(text: string) {
  const normalized = text.toLocaleLowerCase("ko-KR");
  for (const [id, name, keywords] of HOT_VIDEO_CATEGORIES) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return { id, name };
  }
  return { id: "other", name: "기타" };
}

export function hotVideoFormat(durationSeconds: number): HotVideoFormat | "reference" | "excluded" {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return "excluded";
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

export function appendHotVideoSnapshot(previous: YoutubeViewSnapshot[], next: YoutubeViewSnapshot) {
  const byTime = new Map(previous.map((snapshot) => [snapshot.measuredAt, snapshot]));
  byTime.set(next.measuredAt, next);
  return [...byTime.values()]
    .filter((snapshot) => Number.isFinite(snapshot.views) && Number.isFinite(Date.parse(snapshot.measuredAt)))
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt))
    .slice(-3);
}

function shortBaseline(target: BaselineVideo, candidates: BaselineVideo[]) {
  const sample = [...new Map(candidates.map((video) => [video.id, video])).values()]
    .filter((video) => video.id !== target.id && video.channelId === target.channelId && video.durationSeconds > 0 && video.durationSeconds <= 60 && Number.isFinite(video.views) && video.views >= 0)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 20);
  if (sample.length < 20) return { state: "insufficient" as const, sampleCount: sample.length, ratio: null, medianViews: null, reason: "같은 채널 쇼츠 표본 20개가 필요합니다." };
  const baseline = median(sample.map((video) => video.views));
  return { state: "measured" as const, sampleCount: sample.length, ratio: baseline && baseline > 0 ? target.views / baseline : null, medianViews: baseline, reason: "같은 채널 최근 쇼츠 20개의 중앙값과 비교합니다." };
}

export function buildHotVideoScores(input: {
  target: BaselineVideo;
  channelVideos: BaselineVideo[];
  subscribers: number | null;
  snapshots: YoutubeViewSnapshot[];
  now?: number;
}) {
  const format = hotVideoFormat(input.target.durationSeconds);
  const baseline = format === "long"
    ? outlierBaseline(input.target, input.channelVideos, input.now)
    : format === "short"
      ? shortBaseline(input.target, input.channelVideos)
      : { state: "excluded" as const, sampleCount: 0, ratio: null, medianViews: null, reason: "1~4분 참고 영상은 성과도 비교에서 제외합니다." };
  const momentum = youtubeMomentum(input.snapshots);
  return {
    performance: baseline.ratio,
    performanceBaselineViews: baseline.medianViews,
    performanceState: baseline.state as HotVideoItem["performanceState"],
    performanceReason: baseline.reason,
    performanceSampleCount: baseline.sampleCount,
    contribution: input.subscribers && input.subscribers > 0 ? input.target.views / input.subscribers : null,
    exposureVelocity: momentum.velocity,
    exposureAcceleration: momentum.acceleration,
    momentumState: momentum.state,
  };
}

export function hotVideoQuotaEstimate(regionCount = HOT_VIDEO_REGIONS.length, candidateLimit = HOT_VIDEO_CANDIDATE_LIMIT) {
  const discoveryUnits = regionCount * 103;
  const maximumBaselineUnits = regionCount * candidateLimit * 6;
  return {
    dailyUnits: discoveryUnits + maximumBaselineUnits,
    discoveryUnits,
    maximumBaselineUnits,
    detail: `지역 ${regionCount}곳 × 발견 103 + 후보 ${candidateLimit}개 × 채널 기준선 최대 6`,
  };
}
