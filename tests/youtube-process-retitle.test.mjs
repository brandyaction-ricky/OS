import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as scriptCheck from "../lib/youtube-script-check.ts";
import * as narration from "../lib/youtube-narration-document.ts";
import * as project from "../lib/youtube-process/project.ts";
import * as stages from "../lib/youtube-process/stages.ts";
import * as seoColumn from "../lib/seo-column.ts";
import * as short from "../lib/youtube-process/short.ts";
import * as discover from "../lib/youtube-process/discover.ts";

// 최종 썸네일 [고치기] · [공식대로 다시 뽑기] (owner request 2026-10-25): a slot's title and copy change on purpose,
// the staff AI's candidates follow the 패키징 정본 and wait beside the slot, and every later screen reads the same pair.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-process-ai.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
let written = null;
const modules = { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/youtube-script-check": scriptCheck, "@/lib/youtube-narration-document": narration,
  "@/lib/youtube-process/project": project, "@/lib/youtube-process/stages": stages, "@/lib/seo-column": seoColumn, "@/lib/youtube-process/short": short,
  // Ten 기획 documents come back for 소구점 and 기획; the 패키징 정본 is the oldest of the 제목 · 썸네일 ones.
  "./content-generation": { procedureRefs: async (_supabase, action) => action === "title_package" ? [{ id: "thumblog", title: "썸네일 결정 로그" }, { id: "1399076c", title: "패키징_절차" }]
    : Array.from({ length: 10 }, (_, index) => ({ id: `${action}-${index}`, title: `기획 문서 ${index}` })) },
  "./youtube-process-stages": { assertColumnOpen: () => undefined, writeStage: async (_supabase, _actor, _team, _project, kind, current, data) => { written = { kind, current, data }; return { id: "make", version: current.version + 1 }; } } };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => modules[name] });
const ai = compiled.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const now = "2026-10-25T00:00:00Z";
const confirmed = { at: now, A: { title: "퇴사 전에 이것부터", thumb: { id: "a", mode: "text", copy: "회사야, 일이야?", screen: "책상" } }, B: { title: "싫은 건 역할이었다", thumb: { id: "b", mode: "text", copy: "역할이 싫었다" } } };
const record = (id, extra) => ({ id, version: 1, archived_at: null, created_at: now, owner_id: "owner", metadata: {}, ...extra });
const state = (stage, make = {}) => ({
  source: record("project", { title: "퇴사 전 순서", team: "콘텐츠", metadata: { workflow: "youtube_v1", yp: { ...project.newProjectMeta({ type: "anim", target: "퇴사를 고민하는 직장인", note: "제목 공식: [대상]이 몰랐던 [결과]",
    refs: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", title: "회사가 싫은 게 아니었다" }] }, now).yp, stage } } }),
  records: [
    record("plan", { record_type: "content_package", metadata: { packageKind: "yp_plan", yp: { ...stages.emptyStage("plan", "anim"), confirmed } } }),
    record("outline", { record_type: "content_script", metadata: { scriptKind: "yp_outline", yp: { ...stages.emptyStage("outline", "anim"), script: "## 오프닝\n\n싫은 게 회사인지 일인지부터 나눠 봐요.\n" } } }),
    record("make", { record_type: "content_package", metadata: { packageKind: "yp_make", yp: { ...stages.emptyStage("make", "anim"), ...make } } }),
  ],
});
const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "리키" } }) }) }) }) };
const author = { model: "claude-opus-5-5", jobId: "job", name: "키 이름" };
const item = (hook, text = "싫은 건 회사가 아니었다", pattern = 1) => ({ text, hook, pattern, why: "[조건 호명] 슬롯을 「끝까지 남는 칸이 환경」으로 · 6요소 21점" });

test("the go-out pair: confirmed by default, an edit wins, empty fields keep the confirmed one, the old A title still reads", () => {
  const make = stages.emptyStage("make", "anim");
  assert.deepEqual(plain(stages.finalPair({ confirmed }, make, "A")), { title: "퇴사 전에 이것부터", copy: "회사야, 일이야?", thumb: confirmed.A.thumb, changed: false, reason: "" });
  assert.equal(stages.finalPair({ confirmed }, make, "C"), null);
  const copyOnly = stages.finalPair({ confirmed }, { ...make, edits: { B: { title: "", copy: "역할이 문제였다", reason: "더 짧게", at: now, by: "리키" } } }, "B");
  assert.equal(copyOnly.title, "싫은 건 역할이었다");
  assert.equal(copyOnly.thumb.copy, "역할이 문제였다");
  assert.equal(copyOnly.changed, true);
  assert.equal(copyOnly.reason, "더 짧게");
  // 'A 제목 바꿔 보기' saved before 2026-10-25.
  const legacy = stages.finalPair({ confirmed }, { ...make, aTitle: "회사가 싫은 걸까", aReason: "질문형" }, "A");
  assert.equal(legacy.title, "회사가 싫은 걸까");
  assert.equal(legacy.copy, "회사야, 일이야?");
  assert.equal(legacy.reason, "질문형");
});

test("다시 뽑기 opens in 제작 · 최종 검토 for a confirmed slot; the key follows the slot and the reason only", () => {
  assert.throws(() => ai.assertV1RetitleInputs(state("outline"), "A"), (error) => error.status === 409);
  assert.throws(() => ai.assertV1RetitleInputs(state("make"), "C"), (error) => error.code === "SLOT_EMPTY");
  assert.doesNotThrow(() => ai.assertV1RetitleInputs(state("review"), "B"));
  assert.equal(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make", { edits: { A: { title: "x", copy: "", reason: "y", at: now, by: "리키" } } }), "A", ""));
  assert.notEqual(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make"), "B", ""));
  assert.notEqual(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make"), "A", "너무 길어요"));
});

// The 기획실 search for 「퇴사 고민」 (2026-10-25): 34 kept of 50, shorts and longform counted apart.
const realTitles = ["이런 경우엔 빨리 퇴사하세요! 퇴사징조, 퇴사시그널 3가지", "이런 증상이 있다면 빨리 퇴사하세요", "회사 때문에 인생 망치기 전에 빨리 퇴사하세요"];
const market = { query: "퇴사 고민", at: now, refs: discover.rankPackagingRefs(Array.from({ length: 24 }, (_, index) => ({
  id: `vid${String(index).padStart(8, "0")}`, title: realTitles[index] ?? `퇴사 레퍼런스 ${index}`, channel: "채널", views: 60_000 + index, subscribers: 1000 * (index + 1), seconds: 600, live: false }))) };
const patterns = { titlePatterns: [{ skeleton: "[조건 호명: 이런 ~면] + 빨리 퇴사하세요", count: "20편 중 3편", examples: ["이런 증상이 있다면 빨리 퇴사하세요", "인생 망치기 전에 빨리 퇴사하세요"] }],
  copyPatterns: { main: [{ skeleton: "퇴사 + [명사]", count: "8장 중 4장", thumbs: [3, 4] }], sub: [{ skeleton: "[~일까요?]", count: "8장 중 2장", thumbs: [3, 7] }] } };

test("the market search keeps 50,000+ views, drops live, ranks by views ÷ subscribers with hidden ones last, and counts shorts apart", () => {
  const video = (id, views, subscribers, seconds = 600, live = false) => ({ id, title: id, channel: "c", views, subscribers, seconds, live });
  const ranked = discover.rankPackagingRefs([video("low", 49_999, 10), video("live", 900_000, 10, 600, true), video("hidden", 5_000_000, null),
    video("big", 1_282_882, 197), video("mid", 179_425, 1340), video("short", 1_049_659, 480, 45)]);
  assert.deepEqual(plain(ranked.map(ref => [ref.id, ref.ratio, ref.short])), [["big", 6512.1, false], ["short", 2186.8, true], ["mid", 133.9, false], ["hidden", null, false]]);
  assert.equal(ranked[0].thumbnail, "https://i.ytimg.com/vi/big/hqdefault.jpg");
  assert.equal(discover.rankPackagingRefs(Array.from({ length: 60 }, (_, index) => video(`v${index}`, 60_000, 1000))).length, 40);
  assert.deepEqual(plain(discover.packagingPick(ranked, false).map(ref => ref.id)), ["big", "mid", "hidden"]);
  assert.equal(discover.packagingPick(ranked, true).length, 4);
});

test("the formula is the 정본's: repeated words in order with [slots], main and sub copy apart, counts and real examples, the 기획실 hooks and rules", () => {
  for (const line of ["market.rows 상위 20개 제목에서 여러 제목에 글자 그대로 반복된 단어 · 구절과 그 순서", "바뀌는 자리만 [슬롯]", "형태소 단위(조사 · 어미 · 품사)",
    "뜻으로 뭉뚱그린 요약", "1~3개", "OS가 검색 결과와 대조합니다", "큰 메인 카피(main)와 작은 서브 카피(sub)는 공식을 따로", "thumbs(몇 번째 썸네일인지 1~8)",
    "논조도 우리 내용이 정합니다", "패턴마다 후보가 하나 이상", "숫자·리스트 / 금기·경고 / 질문 / 대비·반전 / 정체 폭로 / 손해·후회 / 방법 제시", "공통 패턴 약함",
    "공포를 과장하지 않습니다", "소거 약속", "제목은 대략 15~40자, 썸네일 문구는 보통 2~7단어", "「패키징_절차」 정본"])
    assert.ok(ai.PACKAGING_FORMULA.includes(line), line);
});

test("pattern evidence must be real: examples are (parts of) searched titles, thumbnail numbers are ones the card showed", () => {
  assert.deepEqual(plain(ai.patternProblems(patterns, market, [])), []);
  const made = { ...patterns, titlePatterns: [{ ...patterns.titlePatterns[0], examples: ["지어낸 제목은 빨리 퇴사하세요"] }] };
  assert.match(ai.patternProblems(made, market, [])[0], /제목 패턴 1의 예시 「지어낸 제목은 빨리 퇴사하세요」가 검색 결과 제목에 없어요/);
  // A title the PD added counts as a reference.
  assert.deepEqual(plain(ai.patternProblems(made, market, ["지어낸 제목은 빨리 퇴사하세요"])), []);
  // 로건 피드백 10/26-5: a comma, quote or space changed in a listed title still counts; an empty example does not.
  assert.deepEqual(plain(ai.patternProblems(made, market, ["「지어낸 제목은, 빨리 퇴사하세요!」 · 채널"])), []);
  assert.equal(ai.patternProblems({ ...patterns, titlePatterns: [{ ...patterns.titlePatterns[0], examples: ["…"] }] }, market, []).length, 1);
  const tooFar = { ...patterns, copyPatterns: { ...patterns.copyPatterns, sub: [{ skeleton: "x", count: "1장", thumbs: [8, 8] }] } };
  assert.deepEqual(plain(ai.patternProblems(tooFar, { ...market, refs: market.refs.slice(0, 5) }, [])
    .filter(problem => /썸네일/.test(problem))), ["서브 패턴 1의 썸네일 8번은 없어요 — 1~5번 중에서 적어요", "서브 패턴 1의 썸네일 8번은 없어요 — 1~5번 중에서 적어요"]);
  // No search (it failed): nothing to check against.
  assert.deepEqual(plain(ai.patternProblems(made, { query: "q", at: now, refs: [] }, [])), []);
});

test("the 다시 뽑기 card carries the search (thumbnails on the top 8 only), the 원고, the reason and the pattern shape", async () => {
  const card = await ai.v1RetitleCard({}, state("make"), 30, "B", "너무 길어요", market);
  assert.match(card, /패키징_절차 \(doc_id: 1399076c\)/);
  assert.match(card, /최종 썸네일 B의 제목 · 썸네일 문구/);
  assert.match(card, /제목 후보 8개와 썸네일 문구 후보 8개를 따로/);
  assert.match(card, /"titlePatterns": \[\{ "skeleton"/);
  assert.match(card, /"copyPatterns": \{ "main"/);
  assert.match(card, /"pattern": 1/);
  assert.ok(card.includes(ai.PACKAGING_FORMULA));
  assert.match(card, /"query": "퇴사 고민"/);
  const inputs = JSON.parse(card.slice(card.indexOf("{\n", card.indexOf("## 이 영상의 입력")), card.indexOf("\n\n## 제출")));
  assert.equal(inputs.market.rows.length, 20);
  assert.equal(inputs.market.rows.filter(row => row.thumbnail).length, 8);
  assert.equal(inputs.market.rows[0].title, realTitles[0]);
  assert.match(card, /https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
  assert.match(card, /싫은 게 회사인지 일인지부터 나눠 봐요/);
  assert.match(card, /"reason": "너무 길어요"/);
  assert.match(card, /reason은 PD가/);
  assert.doesNotMatch(await ai.v1RetitleCard({}, state("make"), 30, "A", ""), /reason은 PD가/);
  // A failed search still goes out, saying so, and the AI looks for itself.
  assert.match(await ai.v1RetitleCard({}, state("make"), 30, "A", "", { query: "퇴사 고민", at: now, refs: [], error: "유튜브 검색을 하지 못했어요." }), /"error": "유튜브 검색을 하지 못했어요\."/);
});

test("the 기획안's first titles follow the same formula and search, return the patterns, and the 패키징 정본 comes first with no fixed 12 letters", async () => {
  const card = await ai.v1PlanCard({}, state("draft"), 45, market);
  assert.ok(card.includes(ai.PACKAGING_FORMULA));
  assert.doesNotMatch(card, /12자/);
  assert.match(card, /먼저 끝까지 열 문서 \(doc_id로 엽니다\)\n- 패키징_절차 \(doc_id: 1399076c\)/);
  assert.match(card, /"query": "퇴사 고민"/);
  assert.match(card, /https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
  assert.match(card, /"titlePatterns": \[\{ "skeleton"/);
  const plan = { titles: ["이런 경우엔 퇴사 말고 자리부터 바꾸세요", "퇴사가 고민될 때 판단하는 순서", "퇴사하고 싶다면 이거 보고 결정하세요"], thumbs: [{ screen: "s", copy: "퇴사 전 네 칸" }, { screen: "s", copy: "회사만 바꾸지 마세요" }],
    opening: "o", body: "b", closing: "c", note: "", ...patterns };
  await assert.rejects(ai.saveV1Plan(supabase, "owner", state("draft"), { ...plan, titlePatterns: [{ ...patterns.titlePatterns[0], examples: ["없는 제목"] }] }, author, market),
    (error) => error.code === "PLAN_PATTERNS_UNSUPPORTED");
  const { titlePatterns, ...noPatterns } = plan;
  await assert.rejects(ai.saveV1Plan(supabase, "owner", state("draft"), noPatterns, author, market), (error) => error.code === "PLAN_RESULT_INVALID" && titlePatterns.length === 1);
  await ai.saveV1Plan(supabase, "owner", state("draft"), plan, author, market);
  assert.equal(written.kind, "plan");
  assert.equal(written.data.ai.patterns.titlePatterns[0].skeleton, "[조건 호명: 이런 ~면] + 빨리 퇴사하세요");
  assert.deepEqual(plain(written.data.ai.patterns.market), { query: "퇴사 고민", count: 24 });
});

test("candidates fill the patterns and wait beside the slot without changing the pair", async () => {
  const four = [item("질문"), item("반전"), item("정체 폭로"), item("방법 제시")];
  const result = (titles, copies = four) => ({ ...patterns, titles, copies });
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), result([item("질문"), item("반전"), item("폭로")]), author, "A"), (error) => error.status === 422);
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), { ...result(four), copyPatterns: undefined }, author, "A"), (error) => error.status === 422);
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), result(four, [item("질문"), item("질문"), item("반전"), item("반전")]), author, "A"),
    (error) => error.code === "RETITLE_HOOKS_SAME" && /썸네일 문구/.test(error.message));
  // A candidate pointing at a pattern that isn't there, or a pattern nobody filled, goes back.
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), result([...four.slice(1), item("질문", "x", 2)]), author, "A", market),
    (error) => error.code === "RETITLE_PATTERNS_UNSUPPORTED" && /pattern은 1~1/.test(error.message));
  const twoPatterns = { ...patterns, titlePatterns: [...patterns.titlePatterns, { skeleton: "[N]가지", count: "20편 중 3편", examples: ["퇴사징조, 퇴사시그널 3가지"] }] };
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), { ...twoPatterns, titles: four, copies: four }, author, "A", market),
    (error) => /제목 패턴 2을 채운 후보가 없어요/.test(error.message));
  // A copy longer than a thumbnail holds (40 letters) goes back.
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), result(four, [...four.slice(1), item("질문", "가".repeat(41))]), author, "A"), (error) => error.status === 422);
  const saved = await ai.saveV1Retitle(supabase, "owner", state("make", { edits: { B: { title: "남은 칸", copy: "", reason: "r", at: now, by: "리키" } } }),
    result([...four, item("손해·후회"), item("숫자·리스트"), item("금기·경고"), item("대비·반전")], [{ ...item("질문", "퇴사 전 네 칸"), sub: "버티는 게 답일까요?" }, ...four.slice(1)]), author, "A", market);
  assert.deepEqual(plain(saved), { slot: "A", titles: 8, copies: 4 });
  assert.equal(written.kind, "make");
  assert.equal(written.data.redo.A.by, "리키");
  assert.equal(written.data.redo.A.copyPatterns.sub[0].skeleton, "[~일까요?]");
  assert.deepEqual(plain(written.data.redo.A.market), { query: "퇴사 고민", count: 24 });
  assert.equal(written.data.redo.A.titles.length, 8);
  assert.equal(written.data.redo.A.copies[0].sub, "버티는 게 답일까요?");
  assert.equal(written.data.redo.A.copies[1].sub, "");
  assert.equal(written.data.edits.B.title, "남은 칸");
  assert.equal(written.data.edits.A, undefined);
});

test("the video goes out with the edited A title and copy", () => {
  const edited = state("make", { edits: { A: { title: "회사가 싫은 걸까", copy: "일이 싫은 걸까", reason: "질문형", at: now, by: "리키" } } });
  assert.equal(ai.v1Title(ai.v1Stages(edited)), "회사가 싫은 걸까");
  assert.equal(ai.v1KitCardInputs(edited).thumbnailCopy, "일이 싫은 걸까");
  assert.equal(ai.v1Title(ai.v1Stages(state("make"))), "퇴사 전에 이것부터");
});
