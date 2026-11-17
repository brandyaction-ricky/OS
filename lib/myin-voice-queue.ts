// 대기 순서 (로건 요청 94ba5545, 2026-11-17): the render PC makes one voice at a time (a new video's takes about an hour), so a voice
// that waits says what the PC is on now and about when it starts.
export interface VoiceQueue { pcOn: boolean; ahead: number; minutes: number; now: { title: string; stage: string; left: number } | null }

const DOING: Record<string, string> = { words_pending: "음성을 만드는", final_pending: "전체 영상을 만드는", prep_pending: "자료를 준비하는", clips_pending: "장면 그림을 만드는",
  cta_pending: "구독 대사를 만드는", breath_pending: "숨 자리를 고르는" };
const about = (minutes: number) => minutes >= 10 ? Math.round(minutes / 5) * 5 : minutes;
export function queueText(q: VoiceQueue) {
  if (!q.pcOn) return `영상 만드는 컴퓨터가 꺼져 있어요 · 켜지면 ${q.ahead ? `앞의 음성 ${q.ahead}편 다음에` : "바로"} 만들어요`;
  const now = q.now ? `영상 만드는 컴퓨터가 지금 ${q.now.title ? `「${q.now.title.length > 20 ? `${q.now.title.slice(0, 20).trimEnd()}…` : q.now.title}」 ` : "다른 "}${DOING[q.now.stage] ?? "작업을 하는"} 중(약 ${about(q.now.left)}분 남음)` : "";
  const ahead = q.ahead ? `앞에 음성 ${q.ahead}편` : "";
  const start = q.minutes > 0 ? `약 ${about(q.minutes)}분 뒤 시작` : "곧 시작";
  return [now, ahead, start].filter(Boolean).join(" · ");
}
