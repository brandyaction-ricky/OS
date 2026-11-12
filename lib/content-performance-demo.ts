// 영상 성과 연습 화면: made-up day rows for the chosen dates so the demo shows the screen as staff see it. Browser memory only.
import { demoRecord } from "./demo-record";
import { addDays, kstDay } from "./performance-period";
import type { OsRecord } from "./record-types";

const VIDEOS = [
  ["직업 고민, 이 순서대로만 찾으면 됩니다", "long", 52], ["이직해도 똑같이 답답한 진짜 이유", "long", 38], ["재능은 있는데 왜 나는 내 걸 모를까", "long", 31],
  ["누구나 월 1000만원? 나만 못 버는 것 같다면", "long", 24], ["불안할 필요가 없는 이유", "shorts", 12], ["방법보다 이게 먼저다", "shorts", 9],
  ["20대인데 하고 싶은 걸 못 찾겠어요", "long", 6], ["결핍부터 찾아보세요", "shorts", 3],
] as const;

/** One row per video per day after its upload, views settling down from launch; same numbers on every visit. */
export function demoMetricWindow(from: string, to: string, owner = "demo"): OsRecord[] {
  const today = kstDay(), rows: OsRecord[] = [];
  VIDEOS.forEach(([title, format, ago], index) => {
    const published = addDays(today, -ago), videoId = `demo-video-${index + 1}`;
    for (let day = from > published ? from : published; day <= to && day <= today; day = addDays(day, 1)) {
      const age = Math.max(0, Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${published}T00:00:00Z`)) / 86_400_000));
      const wobble = ((index * 7 + age * 13) % 11) / 10;
      const base = format === "shorts" ? 900 : 420;
      const views = Math.round(base * (1.6 / (1 + age * 0.35) + 0.25) * (0.8 + wobble * 0.4) * (1 - index * 0.06));
      rows.push(demoRecord({ recordType: "content_metric", title, brand: "브랜디액션", startsAt: `${day}T12:00:00Z`, metric_current: views, sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        metadata: { contentId: videoId, platform: "YouTube", format, metricMode: "daily", dataSource: "youtube_analytics_daily", day, views,
          retention: Math.round((format === "shorts" ? 62 : 34) + wobble * 8), subscribers: Math.round(views / (format === "shorts" ? 160 : 70)), likes: Math.round(views / 30), mock: true } }, owner));
    }
  });
  return rows;
}
