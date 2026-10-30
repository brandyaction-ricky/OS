// 롱폼 주제 (owner 2026-10-30): the rules shared by the 공식 · 주제 후보 job and the 주제 screen.
import { parseYoutubeRef } from "./project.ts";
import type { YpShortTopicPick, YpTopicFormula } from "./stages.ts";

type Ref = YpTopicFormula["refs"][number];
/** "제목 · 채널" as the 주제 step writes a reference. */
export const splitRefTitle = (title = "") => { const at = title.lastIndexOf(" · "); return at < 0 ? { title, channel: "" } : { title: title.slice(0, at), channel: title.slice(at + 3) }; };

/** The staff AI's formulas kept to the videos it was given (by video id); a 주제 후보 must follow one of them. The OS counts channels. */
export function topicFormulaRows(result: { formulas: { formula: string; desire: string; refs: string[] }[]; topics: YpShortTopicPick[] }, known: Map<string, Ref>) {
  const idOf = (url: string) => parseYoutubeRef(url)?.videoId ?? "";
  const unknown = [...new Set(result.formulas.flatMap(item => item.refs).filter(url => !known.has(idOf(url))))];
  const names = new Set(result.formulas.map(item => item.formula));
  const problems = [...(unknown.length ? [`목록에 없는 영상: ${unknown.slice(0, 5).join(", ")}`] : []),
    ...result.topics.filter(topic => !names.has(topic.formula)).map(topic => `주제 후보 「${topic.title.slice(0, 30)}」의 formula가 formulas에 없어요 — formulas의 formula를 그대로 적어요`)];
  const formulas: YpTopicFormula[] = problems.length ? [] : result.formulas.map(item => {
    const refs = [...new Set(item.refs.map(idOf))].map(id => known.get(id)!);
    return { formula: item.formula, desire: item.desire, refs, channels: new Set(refs.map(ref => ref.channel || ref.url)).size };
  }).sort((a, b) => b.channels - a.channels);
  return { problems, formulas };
}

/** Where the picked 주제 후보 goes: one block in 전달 사항 (replacing an earlier pick), which the 기획안 job reads. */
export const noteWithPick = (note: string, topic: YpShortTopicPick, formula?: YpTopicFormula) => [
  ...note.split("\n\n").filter(part => part.trim() && !part.startsWith("주제 후보: ")),
  [`주제 후보: ${topic.title}`, `제목 공식: ${topic.formula}${formula ? ` (채널 ${formula.channels}곳)` : ""}`, ...(formula?.desire ? [`시청자가 원하는 것: ${formula.desire}`] : []), `통찰: ${topic.insight}`].join("\n"),
].join("\n\n").slice(0, 2000);
