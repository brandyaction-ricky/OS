// 정본 다듬기 (카드뉴스 설계서 §3 · §9): a fixed 시험 묶음 drawn again under each 정본 version, scored on that content's 평가표, and
// compared run by run. One loop for every kind of content; what differs per kind (the 정본, the 평가표, what a draft is and how it is
// checked) sits in GRIND_KINDS. The rules here are read by the screen and the server; each 정본 is edited in its OS document.
import { cardProblems, type CardDraft } from "../cardnews/formats.ts";
import { checkShortScript, headCopyProblem } from "../youtube-process/short-script.ts";
import type { YpCardSource, YpReview2 } from "../youtube-process/stages.ts";
import { REVIEW2_GATE_NAME, REVIEW2_GATES } from "../youtube-script-review2.ts";
import { threadsPostsProblem } from "../threads-posts.ts";
import { checkColumnHtml } from "../seo-column.ts";

export type GrindKind = "card" | "short" | "threads" | "column";
export type CardGrade = "상" | "중" | "하";
export const CARD_GRADES: CardGrade[] = ["상", "중", "하"];
export interface GrindCriterion { n: 1 | 2 | 3 | 4 | 5 | 6; name: string; top: string }
export type CardCriterion = GrindCriterion["n"];

/** A 숏폼 draft as the 대본 job returns it: the first screen's 헤드 카피, two first lines, the insight and the script (one line = one screen). */
export interface ShortDraft { headCopy: string; hooks: { kind: string; text: string }[]; insight: string; text: string; formula: string }
/** A 스레드 글타래 as the 집필 job returns it: 본문, 관점 댓글, (적용 대댓글), (공개 출처), each one post. */
export interface ThreadsDraft { posts: string[] }
/** An SEO 칼럼 as the 칼럼 job returns it: one HTML document in the OS class contract (lib/seo-column.ts). */
export interface ColumnDraft { html: string }
export type CardDraftPart = Pick<CardDraft, "format" | "slides" | "caption" | "hashtags">;
export type BenchDraft = CardDraftPart | ShortDraft | ThreadsDraft | ColumnDraft;
/** A public post must not carry an OS address (스레드 정본 §1 · 부록 B: 공개 posts에 내부 OS 링크를 넣지 않는다). */
export const internalLinks = (posts: string[]) => posts.filter(post => /brandyaction-os\.vercel\.app/i.test(post)).length;

/**
 * Per kind: the 정본 the drafts follow, its 평가표 (six criteria × 상 · 중 · 하), the record kinds and what the automatic check counts.
 * 카드뉴스: 카드뉴스 정본 §8. 숏폼 대본: 숏폼 대본 정본 §10 판정 검사 1~6 (1 · 2 · 3 failing = 다시 쓰기 there).
 * 스레드: 쓰레드 자동화 운영 정본 §7 교정 · 검수의 관문 여섯, 상 = §4 후보 심사와 §7 「실제로 남길 증거」.
 * SEO 칼럼: 「SEO 칼럼 만드는 절차」에 평가표가 없어 §2 세 가지 최적화 · §3 톤 · §4 구성 · §5 이미지 · §6 하지 말 것에서 여섯을 뽑았다.
 */
/** steward: who scores and proposes 정본 changes when it is not the 대표 (owner decision 2026-10-31: 칼럼 = the person who uploads it). */
export const GRIND_KINDS: Record<GrindKind, { label: string; canonTitle: string; criteria: GrindCriterion[]; bench: string; run: string; findings: (draft: BenchDraft) => number; steward?: string }> = {
  card: { label: "카드뉴스", canonTitle: "카드뉴스 정본", bench: "yp_card_bench", run: "yp_card_bench_run", findings: draft => cardProblems(draft as CardDraftPart).blocking.length, criteria: [
    { n: 1, name: "표지에서 멈추나", top: "누구 이야기인지 바로 보이고, 넘겨 보고 싶다" },
    { n: 2, name: "한 장에 한 메시지", top: "장마다 하나만 말하고, 앞뒤 장이 이어진다" },
    { n: 3, name: "원본에 충실한가 · 근거", top: "원본에 없는 사실 · 숫자가 없다. 단독은 근거가 붙어 있다" },
    { n: 4, name: "우리 말투인가", top: "말하듯 자연스럽고 AI 같은 문장이 없다" },
    { n: 5, name: "포맷에 맞나", top: "글자 수 안, 칸 역할대로, 장 수 범위 안" },
    { n: 6, name: "저장 · 다음 행동", top: "저장하고 싶고, 마지막 장의 다음 행동이 분명하다" }] },
  short: { label: "숏폼 대본", canonTitle: "숏폼 대본 정본", bench: "yp_short_bench", run: "yp_short_bench_run",
    findings: draft => { const short = draft as ShortDraft; return checkShortScript(short.text).problems.length + (headCopyProblem(short.headCopy) ? 1 : 0); }, criteria: [
    { n: 1, name: "첫 화면에서 멈추나", top: "소리 없이 헤드 카피만 봐도 멈추고, 첫 문장만 듣고 다음이 궁금하다" },
    { n: 2, name: "통찰을 한 문장으로", top: "롱폼을 안 본 사람도 다 듣고 통찰을 한 문장으로 말할 수 있다" },
    { n: 3, name: "혼자서 이해되나", top: "처음 듣는 이름 · 대상이 소개 없이 나오지 않는다" },
    { n: 4, name: "통찰이 하나인가", top: "통찰이 딱 하나다" },
    { n: 5, name: "「이거 완전 난데」", top: "듣는 사람이 「이거 완전 난데」 하는 문장이 있다" },
    { n: 6, name: "끝이 제일 센가", top: "마지막 두 줄 중 하나가 이 편에서 제일 센 문장이다" }] },
  threads: { label: "스레드", canonTitle: "쓰레드 자동화 운영 정본 — 안저 · Aside × OS", bench: "yp_threads_bench", run: "yp_threads_bench_run",
    findings: draft => { const posts = (draft as ThreadsDraft).posts; return (threadsPostsProblem(posts, 1) ? 1 : 0) + internalLinks(posts); }, criteria: [
    { n: 1, name: "주제", top: "업계 말을 몰라도 이해되고, 독자가 알고 싶은 질문이 분명하다" },
    { n: 2, name: "첫 줄과 본문", top: "첫 줄에 주제가 보이되 답이 뻔하지 않고, 다음 문장이 실제 장면 · 사실로 받는다" },
    { n: 3, name: "관점의 답", top: "첫 질문에 직접 답한다. 「사람마다 다르다」 말고 새 구별 · 이유 · 조건이 있다" },
    { n: 4, name: "적용", top: "독자가 자기 권한 안에서 할 행동과 달라질 판단이 있다" },
    { n: 5, name: "근거 · 의미", top: "주장마다 출처가 있고 사실 · 해석 · 예시가 구분되며, 쉽게 풀면서 뜻이 바뀌지 않았다" },
    { n: 6, name: "읽기 · 형식", top: "글마다 새 내용이 있고 추상어는 풀어 썼으며, 500자 · 순서를 지켰다" }] },
  column: { label: "SEO 칼럼", canonTitle: "SEO 칼럼 만드는 절차 (정본)", bench: "yp_column_bench", run: "yp_column_bench_run", steward: "칼럼을 올리는 작업자",
    findings: draft => { const { unsafe, issues } = checkColumnHtml((draft as ColumnDraft).html); return unsafe.length + issues.length; }, criteria: [
    { n: 1, name: "검색 질문에 바로 답하나", top: "제목 · 3줄 요약 · 첫 문단만 읽어도 검색한 질문의 답이 나온다" },
    { n: 2, name: "검색되는 말인가", top: "제목 · 소제목 · 키워드가 사람들이 실제로 찾는 말이고, 과장 · 낚시가 없다" },
    { n: 3, name: "원고에 충실한가 · 근거", top: "원고에 없는 사실 · 통계 · 사례가 없고, 단정마다 원고의 근거가 있다" },
    { n: 4, name: "읽는 글인가", top: "대표 말투는 살아 있고 구어체 반복 · 군더더기가 없어, 30대 직장인이 끝까지 읽는다" },
    { n: 5, name: "AI가 인용하기 좋은가", top: "정의 · 단정 문장 · 목록 · 표와 h2 · h3 위계가 또렷해, 문단째 인용할 수 있다" },
    { n: 6, name: "이미지 · FAQ", top: "이미지 자리가 그 대목을 보여 주고 프롬프트 여섯 요소를 갖췄으며, FAQ가 독자가 실제로 물을 질문에 답한다" }] },
};
export const isGrindKind = (value: unknown): value is GrindKind => value === "card" || value === "short" || value === "threads" || value === "column";
/** The 정본 §9 graduation: in a run, 80% of the drafts at 중 or better on every criterion with 상 on four, and no automatic finding. */
export const GRADUATION = { passRate: 0.8, tops: 4 } as const;
export const BENCH_MAX = 8;

/** One 시험 원본, frozen: the text a 카드뉴스 was made from, or a 숏폼's 대본 job card as it was asked (topic · formula · 참고 영상). */
export interface BenchItem {
  id: string; title: string; target: string; note: string; focus: string; source: YpCardSource; from?: { projectId: string; title: string }; at: string; by: string;
  /** 숏폼: the 대본 job card without the PD's script; 스레드: the 집필 card with the topic's 재료; SEO 칼럼: the 칼럼 job card with the confirmed 원고. Drawn again as it is (the 정본 it points to is read anew each run). */
  instructions?: string;
}
export interface Bench { items: BenchItem[] }
export interface BenchScore { name: string; grades: Partial<Record<CardCriterion, CardGrade>>; notes: Partial<Record<CardCriterion, string>>; at: string }
/** One draft of a run: key = item:format (a 숏폼 has the one format 「script」, a 스레드 「posts」, an SEO 칼럼 「html」); the draft, or why GPT could not make one. */
export interface BenchResult { key: string; itemId: string; title: string; format: string; draft?: BenchDraft; error?: string }
export interface BenchRun {
  id: string; canon: string; at: string; by: string; byName: string; model: string; formats: string[];
  state: "running" | "done" | "failed"; error?: string; results: BenchResult[];
  /** result key → scorer id → score; each person scores on their own line. */
  scores: Record<string, Record<string, BenchScore>>;
}
export const resultKey = (itemId: string, format: string) => `${itemId}:${format}`;
/** The version a 정본 calls itself: its 정본 묶음 line, else its 상태 line (v0.7), else its 운영 기준 line (스레드), else the document version. */
export const canonVersion = (text: string, current: number) =>
  text.match(/정본 묶음:\s*\**\s*(v[\d.]+)/)?.[1] ?? text.match(/상태:\s*\**\s*(?:초안\s*)?(v[\d.]+)/)?.[1] ?? text.match(/^운영 기준\s*(v[\d.]+)/m)?.[1] ?? `doc v${current}`;

const RANK: Record<CardGrade, number> = { 하: 0, 중: 1, 상: 2 };
/** A draft's grade per criterion across everyone who scored all six: the lowest one counts (a weak point anyone saw stays seen). */
export function mergedGrades(scores: Record<string, BenchScore> | undefined) {
  const ns = [1, 2, 3, 4, 5, 6] as const;
  const full = Object.values(scores ?? {}).filter(score => ns.every(n => score.grades[n]));
  if (!full.length) return null;
  return Object.fromEntries(ns.map(n => [n, full.map(score => score.grades[n]!).sort((a, b) => RANK[a] - RANK[b])[0]])) as Record<CardCriterion, CardGrade>;
}
export const passes = (grades: Record<CardCriterion, CardGrade>) => {
  const all = Object.values(grades);
  return !all.includes("하") && all.filter(grade => grade === "상").length >= GRADUATION.tops;
};

/** How a run did: drafts made, automatic findings, how many are scored and pass, and whether it meets the graduation. */
export function runSummary(run: Pick<BenchRun, "results" | "scores" | "state">, kind: GrindKind) {
  const made = run.results.filter(result => result.draft);
  const failed = run.results.length - made.length;
  const findings = made.reduce((sum, result) => sum + GRIND_KINDS[kind].findings(result.draft!), 0);
  const merged = made.map(result => mergedGrades(run.scores[result.key])).filter((grades): grades is Record<CardCriterion, CardGrade> => Boolean(grades));
  const passed = merged.filter(passes).length;
  const passRate = merged.length ? passed / merged.length : 0;
  const graduated = run.state === "done" && made.length > 0 && merged.length === made.length && !failed && !findings && passRate >= GRADUATION.passRate;
  return { drafts: made.length, failed, findings, scored: merged.length, passed, passRate, graduated };
}
/** 정본 §9 졸업: the two newest finished runs both meet it. */
export const graduatedTwice = (runs: BenchRun[], kind: GrindKind) => {
  const done = runs.filter(run => run.state === "done").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
  return done.length === 2 && done.every(run => runSummary(run, kind).graduated);
};

/**
 * 고칠 점 of a run, per criterion: every 중 · 하 with its reason. A criterion flagged on two or more different drafts is a 정본 문제
 * (카드뉴스 정본 §8); once is that draft's own problem.
 */
export function fixList(run: Pick<BenchRun, "results" | "scores">, kind: GrindKind) {
  return GRIND_KINDS[kind].criteria.map(c => {
    const notes = run.results.filter(result => result.draft).flatMap(result => Object.values(run.scores[result.key] ?? {})
      .filter(score => score.grades[c.n] && score.grades[c.n] !== "상")
      .map(score => ({ key: result.key, title: result.title, format: result.format, grade: score.grades[c.n]!, note: score.notes[c.n]?.trim() ?? "", by: score.name })));
    const drafts = new Set(notes.map(note => note.key)).size;
    return { n: c.n, name: c.name, drafts, canonIssue: drafts >= 2, notes };
  }).filter(row => row.notes.length).sort((a, b) => b.drafts - a.drafts);
}

// 롱폼 원고 (설계서 §9): never drawn again — the staff AI writes a 롱폼 in several steps, so a one-shot GPT redraw would not be the real
// process. Each 원고's 두 번째 검수 (원고 검수 정본 관문 2~6) is its score, grouped by the 정본 묶음 its writer submitted.
export interface ScriptVerdict { projectId: string; title: string; at: string; by: string; bundle: string; pass: boolean; gates: YpReview2["gates"] }
/** The 정본 묶음 a 원고 was written under, from the value its writer submitted ("v2.5 (2026-10-30)" → v2.5). */
export const scriptBundle = (submitted: string | null | undefined) => submitted?.match(/v\d+(?:\.\d+)*/)?.[0] ?? "묶음 모름";
/** The newest 정본 묶음 first (by their newest 원고): how many 원고, how many passed every gate, and each gate's 반려. */
export function scriptBundles(verdicts: ScriptVerdict[], limit = 3) {
  const groups = new Map<string, ScriptVerdict[]>();
  for (const verdict of [...verdicts].sort((a, b) => b.at.localeCompare(a.at))) groups.set(verdict.bundle, [...(groups.get(verdict.bundle) ?? []), verdict]);
  return [...groups].slice(0, limit).map(([bundle, scripts]) => {
    const passed = scripts.filter(script => script.pass).length;
    return { bundle, scripts, passed, passRate: passed / scripts.length,
      gates: REVIEW2_GATES.map(gate => ({ gate, name: REVIEW2_GATE_NAME[gate], failed: scripts.filter(script => turnedBack(script, gate)).length })) };
  });
}
const turnedBack = (script: ScriptVerdict, gate: number) => script.gates.some(row => row.gate === gate && !row.pass);
/** 졸업 for 원고: the two newest 정본 묶음 both have 80% of their 원고 through every gate. */
export const scriptGraduated = (bundles: ReturnType<typeof scriptBundles>) =>
  bundles.length >= 2 && bundles.slice(0, 2).every(row => row.bundle !== "묶음 모름" && row.passRate >= GRADUATION.passRate);
/** 고칠 점 of one 정본 묶음: each gate that turned a 원고 back with what it pointed at; turned back on two or more 원고 = 정본 문제. */
export function scriptFixes(scripts: ScriptVerdict[]) {
  return REVIEW2_GATES.map(gate => {
    const failed = scripts.filter(script => turnedBack(script, gate));
    const notes = failed.flatMap(script => (script.gates.find(row => row.gate === gate)?.items ?? []).map(item => ({ projectId: script.projectId, title: script.title, ...item })));
    return { gate, name: REVIEW2_GATE_NAME[gate], scripts: failed.length, canonIssue: failed.length >= 2, notes };
  }).filter(row => row.scripts).sort((a, b) => b.scripts - a.scripts);
}
