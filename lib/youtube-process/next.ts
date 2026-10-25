// What a video needs next, in one sentence and one button (owner request 2026-10-21: usable without any guide text).
import { GATE_FIELDS, GATE_NAME } from "./confirm.ts";
import { flowOf, projectHref, stepName, YP_STAGE_INDEX, type YpGate, type YpProject } from "./project.ts";

export type YpTone = "todo" | "wait" | "fix" | "hold" | "done";
/** step = how many of the project's `total` steps lie behind it (a 숏폼 has four). */
export interface YpNext { tone: YpTone; text: string; button: string; href: string; step: number; total: number; stepName: string }

const TODO: Record<Exclude<YpProject["yp"]["stage"], "done">, [string, string]> = {
  topic: ["주제를 마저 쓰고 컨펌을 요청해요", "주제 쓰기"],
  draft: ["제목 · 썸네일 · 영상 흐름을 정해요", "기획안 쓰기"],
  outline: ["러닝타임과 원고를 정해요", "원고 쓰기"],
  make: ["영상을 만들고 최종 썸네일을 올려요", "영상 만들기"],
  review: ["완성본을 보고 최종 검수 컨펌을 요청해요", "검수하기"],
  upload: ["설명란을 채우고 유튜브에 올려요", "올리기"],
  shorts: ["쇼츠 대본을 골라 컨펌받고, SEO 칼럼을 만들어요", "쇼츠 · 칼럼"],
};
// A 숏폼's 제작 holds what to make, the scenes and the MP4; it is handed out by download, not uploaded to YouTube here.
const SHORT_TODO: Partial<typeof TODO> = { make: ["무엇을 만들지 정하고 장면 · MP4를 만들어요", "숏폼 만들기"], upload: ["완성한 MP4를 내려받아 올려요", "내보내기"] };
const GATE_OF: Partial<Record<YpProject["yp"]["stage"], YpGate>> = { topic: "topic", draft: "draft", review: "review", shorts: "shorts" };

export function nextAction(project: Pick<YpProject, "id" | "yp">): YpNext {
  const { stage, gates } = project.yp;
  const flow = flowOf(project.yp.topic.type);
  const index = stage === "done" ? -1 : YP_STAGE_INDEX[stage];
  const step = stage === "done" ? flow.length : Math.max(0, flow.findIndex(item => item.index === index));
  const base = { href: projectHref(project), step, total: flow.length, stepName: stage === "done" ? "완료" : stepName(index, project.yp.topic.type) };
  if (stage === "done") return { ...base, tone: "done", text: "끝난 영상이에요", button: "보기" };
  const gate = GATE_OF[stage];
  const info = gate ? gates[gate] : null;
  if (gate && info?.state === "wait") return { ...base, tone: "wait", text: `${GATE_NAME[gate]} 기다리는 중 · 지금 할 일 없어요`, button: "보기" };
  if (gate && info?.state === "changes") return { ...base, tone: "fix", text: `대표 수정 요청 · ${(info.fields ?? []).map(field => GATE_FIELDS[gate][field] ?? field).join(", ")}을 고쳐요`, button: "고치기" };
  if (gate && info?.state === "hold") return { ...base, tone: "hold", text: `보류됨${info.reason ? ` · ${info.reason}` : ""}`, button: "보기" };
  const [text, button] = (project.yp.topic.type === "short" ? SHORT_TODO[stage] : undefined) ?? TODO[stage];
  return { ...base, tone: "todo", text, button };
}
