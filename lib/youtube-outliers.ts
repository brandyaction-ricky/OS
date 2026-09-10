export interface BaselineVideo { id: string; channelId: string; title: string; publishedAt: string; views: number; durationSeconds: number; live?: boolean; categoryId?: string }
export interface YoutubeViewSnapshot { views: number; measuredAt: string }
export type YoutubeFormatBucket = "4–12분" | "12–30분" | "30–60분" | "60분 이상";

export function youtubeFormatBucket(durationSeconds: number): YoutubeFormatBucket | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 240) return null;
  if (durationSeconds < 720) return "4–12분";
  if (durationSeconds < 1_800) return "12–30분";
  if (durationSeconds < 3_600) return "30–60분";
  return "60분 이상";
}

export function youtubeAgeCheckpoint(publishedAt: string, now = Date.now()) {
  const ageDays = Math.max(0, (now - Date.parse(publishedAt)) / 86_400_000);
  if (!Number.isFinite(ageDays)) return null;
  if (ageDays < 30) return "D+7";
  if (ageDays < 90) return "D+30";
  return "D+90";
}
export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function youtubeMomentum(snapshots: YoutubeViewSnapshot[]) {
  const ordered = snapshots.filter((item) => Number.isFinite(item.views) && Number.isFinite(Date.parse(item.measuredAt)))
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt)).slice(-3);
  if (ordered.length < 3) return { state: "insufficient" as const, velocity: null, previousVelocity: null, acceleration: null, rising: false };
  const firstHours = (Date.parse(ordered[1].measuredAt) - Date.parse(ordered[0].measuredAt)) / 3_600_000;
  const secondHours = (Date.parse(ordered[2].measuredAt) - Date.parse(ordered[1].measuredAt)) / 3_600_000;
  if (firstHours < .25 || secondHours < .25) return { state: "insufficient" as const, velocity: null, previousVelocity: null, acceleration: null, rising: false };
  const previousVelocity = Math.max(0, ordered[1].views - ordered[0].views) / firstHours;
  const velocity = Math.max(0, ordered[2].views - ordered[1].views) / secondHours;
  const acceleration = (velocity - previousVelocity) / ((firstHours + secondHours) / 2);
  return { state: "measured" as const, velocity, previousVelocity, acceleration, rising: velocity >= 50 && velocity >= Math.max(1, previousVelocity) * 1.5 && acceleration > 0 };
}
export function outlierBaseline(target: BaselineVideo, candidates: BaselineVideo[], now = Date.now()) {
  const age = (video: BaselineVideo) => Math.max(0, (now - Date.parse(video.publishedAt)) / 86_400_000);
  const excluded = (video: BaselineVideo) => video.durationSeconds < 240 || video.live || /(?:#shorts|쇼츠|재업로드|재업|reupload)/i.test(video.title);
  const targetAge = age(target);
  if (!Number.isFinite(targetAge) || targetAge <= 0 || excluded(target)) return { state: "excluded", sampleCount: 0, ratio: null, robustZ: null, medianViews: null, outlier: false, reason: "4분 이상 일반 영상만 비교합니다. 라이브·쇼츠·재업로드 제외." };
  const formatBucket = youtubeFormatBucket(target.durationSeconds);
  // Age tolerance is explicit: one half to twice the target's elapsed publication age.
  const uniqueCandidates = [...new Map(candidates.map((video) => [video.id, video])).values()];
  const sample = uniqueCandidates.filter((video) => Number.isFinite(video.views) && video.views >= 0 && video.id !== target.id && video.channelId === target.channelId && !excluded(video) && youtubeFormatBucket(video.durationSeconds) === formatBucket && age(video) >= targetAge * .5 && age(video) <= targetAge * 2)
    .sort((a, b) => Math.abs(age(a) - targetAge) - Math.abs(age(b) - targetAge)).slice(0, 20);
  if (sample.length < 20) return { state: "insufficient", sampleCount: sample.length, ratio: null, robustZ: null, medianViews: null, outlier: false, reason: `같은 채널·${formatBucket}·유사 경과일 표본 20개가 필요합니다.`, formatBucket, ageCheckpoint: youtubeAgeCheckpoint(target.publishedAt, now) };
  const baseline = median(sample.map((video) => video.views))!;
  const mad = median(sample.map((video) => Math.abs(video.views - baseline)))!;
  const ratio = baseline > 0 ? target.views / baseline : null;
  const robustZ = mad > 0 ? (target.views - baseline) / (1.4826 * mad) : null;
  const news = target.categoryId === "25";
  return { state: "measured", sampleCount: sample.length, ratio, robustZ, medianViews: baseline, outlier: !news && ((ratio !== null && ratio >= 3) || (robustZ !== null && robustZ >= 3.5)), reason: news ? "뉴스 카테고리 · 화제성 별도 검토" : `현재 누적 기준 · 같은 채널 ${formatBucket} 20개 · 유사 경과일 · 인물 의존도 수동 검토`, sampleIds: sample.map((video) => video.id), formatBucket, ageCheckpoint: youtubeAgeCheckpoint(target.publishedAt, now) };
}
