// 주제 찾기 한 곳 (owner 2026-10-28: "레퍼런스 수집 화면에서 스레드 주제도 뽑고, 숏츠, 광고도 다 한 곳에서 주제를 뽑는 거지? …
// 플랫폼별로 헷갈리지 않도록"): one switch for what is being made. Each platform keeps its own references and its own 반응도 기준,
// and shows them in the same places, with the same name and colour everywhere in the OS.
import { BREAKOUT } from "./youtube-process/discover.ts";
import { SHORT_REF_BAR_TEXT } from "./youtube-process/short-script.ts";
import { REFERENCE_POLICY } from "./threads-reference.ts";

export type TopicPlatform = "longform" | "short" | "ad" | "threads";
export const TOPIC_PLATFORM_ORDER: TopicPlatform[] = ["longform", "short", "ad", "threads"];
export const TOPIC_PLATFORMS: Record<TopicPlatform, { label: string; makes: string; refs: string; bar: string }> = {
  longform: { label: "롱폼", makes: "유튜브 8~15분 영상", refs: "유튜브 롱폼", bar: `채널 평소 조회수의 ${BREAKOUT.ratio}배 넘게 나온 영상` },
  short: { label: "숏폼 · 릴스", makes: "세로 30~60초 영상", refs: "유튜브 쇼츠 · 틱톡 · 릴스", bar: SHORT_REF_BAR_TEXT },
  ad: { label: "광고", makes: "메타 광고로 돌릴 세로 영상", refs: "메타 광고 라이브러리", bar: "30일 넘게 켜진 영상 광고 · 같은 광고의 버전이 많을수록 앞" },
  threads: { label: "스레드", makes: "스레드 글", refs: "스레드 · 서브스택 글", bar: `조회 ${REFERENCE_POLICY.threadsMinViews / 10_000}만 이상(확인된 숫자)` },
};
export const isTopicPlatform = (value: string | null): value is TopicPlatform => TOPIC_PLATFORM_ORDER.includes(value as TopicPlatform);
/** A video's platform as 주제 찾기 names it: a 숏폼 made as an ad is 광고. */
export const projectPlatform = (topic: { type: string | null; purpose?: "ad" | null }): TopicPlatform =>
  topic.type === "short" ? (topic.purpose === "ad" ? "ad" : "short") : "longform";
