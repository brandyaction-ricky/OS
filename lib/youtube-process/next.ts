// What a video needs next, in one sentence and one button (owner request 2026-10-21: usable without any guide text).
import { GATE_FIELDS, GATE_NAME } from "./confirm.ts";
import { projectHref, YP_FLOW, YP_STAGE_INDEX, type YpGate, type YpProject } from "./project.ts";

export type YpTone = "todo" | "wait" | "fix" | "hold" | "done";
export interface YpNext { tone: YpTone; text: string; button: string; href: string; step: number; stepName: string }

const TODO: Record<Exclude<YpProject["yp"]["stage"], "done">, [string, string]> = {
  topic: ["주제를 마저 쓰고 컨펌을 요청해요", "주제 쓰기"],
  draft: ["제목 · 썸네일 · 영상 흐름을 정해요", "기획안 쓰기"],
  outline: ["러닝타임과 원고를 정해요", "원고 쓰기"],
  make: ["영상을 만들고 최종 썸네일을 올려요", "영상 만들기"],
  review: ["완성본을 보고 최종 검수 컨펌을 요청해요", "검수하기"],
  upload: ["설명란을 채우고 유튜브에 올려요", "올리기"],
  shorts: ["쇼츠로 자를 구간을 골라요", "쇼츠 고르기"],
};
const GATE_OF: Partial<Record<YpProject["yp"]["stage"], YpGate>> = { topic: "topic", draft: "draft", review: "review" };

export function nextAction(project: Pick<YpProject, "id" | "yp">): YpNext {
  const { stage, gates } = project.yp;
  const step = stage === "done" ? YP_FLOW.length : YP_STAGE_INDEX[stage];
  const base = { href: projectHref(project), step, stepName: stage === "done" ? "완료" : YP_FLOW[step] };
  if (stage === "done") return { ...base, tone: "done", text: "끝난 영상이에요", button: "보기" };
  const gate = GATE_OF[stage];
  const info = gate ? gates[gate] : null;
  if (gate && info?.state === "wait") return { ...base, tone: "wait", text: `${GATE_NAME[gate]} 기다리는 중 · 지금 할 일 없어요`, button: "보기" };
  if (gate && info?.state === "changes") return { ...base, tone: "fix", text: `대표 수정 요청 · ${(info.fields ?? []).map(field => GATE_FIELDS[gate][field] ?? field).join(", ")}을 고쳐요`, button: "고치기" };
  if (gate && info?.state === "hold") return { ...base, tone: "hold", text: `보류됨${info.reason ? ` · ${info.reason}` : ""}`, button: "보기" };
  const [text, button] = TODO[stage];
  return { ...base, tone: "todo", text, button };
}
