// 카드뉴스 정본 다듬기 (정본 §8 · §9, 설계서 §3): a fixed 시험 묶음 drawn again under each 정본 version, scored on the 평가표, and
// compared run by run. These are the rules both the screen and the server read; the 정본 itself is edited in the OS document.
import { cardProblems, type CardDraft, type CardFormatId } from "./formats.ts";
import type { YpCardSource } from "../youtube-process/stages.ts";

export type CardGrade = "상" | "중" | "하";
export const CARD_GRADES: CardGrade[] = ["상", "중", "하"];
/** 정본 §8 평가표: six criteria, each 상 · 중 · 하 with a one-line reason. */
export const CARD_CRITERIA = [
  { n: 1, name: "표지에서 멈추나", top: "누구 이야기인지 바로 보이고, 넘겨 보고 싶다" },
  { n: 2, name: "한 장에 한 메시지", top: "장마다 하나만 말하고, 앞뒤 장이 이어진다" },
  { n: 3, name: "원본에 충실한가 · 근거", top: "원본에 없는 사실 · 숫자가 없다. 단독은 근거가 붙어 있다" },
  { n: 4, name: "우리 말투인가", top: "말하듯 자연스럽고 AI 같은 문장이 없다" },
  { n: 5, name: "포맷에 맞나", top: "글자 수 안, 칸 역할대로, 장 수 범위 안" },
  { n: 6, name: "저장 · 다음 행동", top: "저장하고 싶고, 마지막 장의 다음 행동이 분명하다" },
] as const;
export type CardCriterion = (typeof CARD_CRITERIA)[number]["n"];
/** The 정본 §9 graduation: in a run, 80% of the drafts at 중 or better on every criterion with 상 on four, and no automatic finding. */
export const GRADUATION = { passRate: 0.8, tops: 4 } as const;
export const BENCH_MAX = 8;

/** One 시험 원본: the text a 카드뉴스 was made from, frozen, so every 정본 version is drawn from the same thing. */
export interface BenchItem { id: string; title: string; target: string; note: string; focus: string; source: YpCardSource; from?: { projectId: string; title: string }; at: string; by: string }
export interface Bench { items: BenchItem[] }
export interface BenchScore { name: string; grades: Partial<Record<CardCriterion, CardGrade>>; notes: Partial<Record<CardCriterion, string>>; at: string }
/** One draft of a run: key = item:format; the draft, or why GPT could not make one. */
export interface BenchResult { key: string; itemId: string; title: string; format: CardFormatId; draft?: Pick<CardDraft, "format" | "slides" | "caption" | "hashtags">; error?: string }
export interface BenchRun {
  id: string; canon: string; at: string; by: string; byName: string; model: string; formats: CardFormatId[];
  state: "running" | "done" | "failed"; error?: string; results: BenchResult[];
  /** result key → scorer id → score; each person scores on their own line. */
  scores: Record<string, Record<string, BenchScore>>;
}
export const resultKey = (itemId: string, format: CardFormatId) => `${itemId}:${format}`;

const RANK: Record<CardGrade, number> = { 하: 0, 중: 1, 상: 2 };
/** A draft's grade per criterion across everyone who scored all six: the lowest one counts (a weak point anyone saw stays seen). */
export function mergedGrades(scores: Record<string, BenchScore> | undefined) {
  const full = Object.values(scores ?? {}).filter(score => CARD_CRITERIA.every(c => score.grades[c.n]));
  if (!full.length) return null;
  return Object.fromEntries(CARD_CRITERIA.map(c => [c.n, full.map(score => score.grades[c.n]!).sort((a, b) => RANK[a] - RANK[b])[0]])) as Record<CardCriterion, CardGrade>;
}
export const passes = (grades: Record<CardCriterion, CardGrade>) =>
  CARD_CRITERIA.every(c => grades[c.n] !== "하") && CARD_CRITERIA.filter(c => grades[c.n] === "상").length >= GRADUATION.tops;

/** How a run did: drafts made, automatic findings, how many are scored and pass, and whether it meets the graduation. */
export function runSummary(run: Pick<BenchRun, "results" | "scores" | "state">) {
  const made = run.results.filter(result => result.draft);
  const failed = run.results.length - made.length;
  const findings = made.reduce((sum, result) => sum + cardProblems(result.draft!).blocking.length, 0);
  const merged = made.map(result => mergedGrades(run.scores[result.key])).filter((grades): grades is Record<CardCriterion, CardGrade> => Boolean(grades));
  const passed = merged.filter(passes).length;
  const passRate = merged.length ? passed / merged.length : 0;
  const graduated = run.state === "done" && made.length > 0 && merged.length === made.length && !failed && !findings && passRate >= GRADUATION.passRate;
  return { drafts: made.length, failed, findings, scored: merged.length, passed, passRate, graduated };
}
/** 정본 §9 졸업: the two newest finished runs both meet it. */
export const graduatedTwice = (runs: BenchRun[]) => {
  const done = runs.filter(run => run.state === "done").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
  return done.length === 2 && done.every(run => runSummary(run).graduated);
};

/**
 * 고칠 점 of a run, per criterion: every 중 · 하 with its reason. A criterion flagged on two or more different drafts is a 정본 문제
 * (정본 §8); once is that draft's own problem.
 */
export function fixList(run: Pick<BenchRun, "results" | "scores">) {
  return CARD_CRITERIA.map(c => {
    const notes = run.results.filter(result => result.draft).flatMap(result => Object.values(run.scores[result.key] ?? {})
      .filter(score => score.grades[c.n] && score.grades[c.n] !== "상")
      .map(score => ({ key: result.key, title: result.title, format: result.format, grade: score.grades[c.n]!, note: score.notes[c.n]?.trim() ?? "", by: score.name })));
    const drafts = new Set(notes.map(note => note.key)).size;
    return { n: c.n, name: c.name, drafts, canonIssue: drafts >= 2, notes };
  }).filter(row => row.notes.length).sort((a, b) => b.drafts - a.drafts);
}
