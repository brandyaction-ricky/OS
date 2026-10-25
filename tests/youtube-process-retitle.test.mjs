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

// 최종 썸네일 [고치기] · [공식대로 다시 뽑기] (owner request 2026-10-25): a slot's title and copy change on purpose,
// the staff AI's candidates follow the 패키징 정본 and wait beside the slot, and every later screen reads the same pair.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-process-ai.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
let written = null;
const modules = { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/youtube-script-check": scriptCheck, "@/lib/youtube-narration-document": narration,
  "@/lib/youtube-process/project": project, "@/lib/youtube-process/stages": stages, "@/lib/seo-column": seoColumn, "@/lib/youtube-process/short": short,
  "./content-generation": { procedureRefs: async () => [{ id: "1399076c", title: "패키징_절차" }] },
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
const item = (hook, title = "싫은 건 회사가 아니었다") => ({ title, copy: "일이 싫었다", hook, why: "[대상]이 몰랐던 [결과] 슬롯 · 6요소 21점" });

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

test("다시 뽑기 opens in 제작 · 최종 검수 for a confirmed slot; the key follows the slot and the reason only", () => {
  assert.throws(() => ai.assertV1RetitleInputs(state("outline"), "A"), (error) => error.status === 409);
  assert.throws(() => ai.assertV1RetitleInputs(state("make"), "C"), (error) => error.code === "SLOT_EMPTY");
  assert.doesNotThrow(() => ai.assertV1RetitleInputs(state("review"), "B"));
  assert.equal(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make", { edits: { A: { title: "x", copy: "", reason: "y", at: now, by: "리키" } } }), "A", ""));
  assert.notEqual(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make"), "B", ""));
  assert.notEqual(ai.v1RetitleInputKey(state("make"), "A", ""), ai.v1RetitleInputKey(state("make"), "A", "너무 길어요"));
});

test("the job card points at the 패키징 정본, asks for two formulas, and carries the references, the 원고 and the reason as data", async () => {
  const card = await ai.v1RetitleCard({}, state("make"), 30, "B", "너무 길어요");
  assert.match(card, /패키징_절차 \(doc_id: 1399076c\)/);
  assert.match(card, /최종 썸네일 B의 제목 · 썸네일 문구/);
  assert.match(card, /제목 공식\(formula\)과 썸네일 문구 공식\(copyFormula\)을 따로/);
  assert.match(card, /https:\/\/i\.ytimg\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
  assert.match(card, /싫은 게 회사인지 일인지부터 나눠 봐요/);
  assert.match(card, /"reason": "너무 길어요"/);
  assert.match(card, /reason은 PD가/);
  assert.doesNotMatch(await ai.v1RetitleCard({}, state("make"), 30, "A", ""), /reason은 PD가/);
});

test("candidates are checked and wait beside the slot without changing the pair", async () => {
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), { formula: "f", copyFormula: "c", items: [item("질문"), item("반전")] }, author, "A"), (error) => error.status === 422);
  await assert.rejects(ai.saveV1Retitle(supabase, "owner", state("make"), { formula: "f", copyFormula: "c", items: [item("질문"), item("질문"), item("질문")] }, author, "A"), (error) => error.code === "RETITLE_HOOKS_SAME");
  const saved = await ai.saveV1Retitle(supabase, "owner", state("make", { edits: { B: { title: "남은 칸", copy: "", reason: "r", at: now, by: "리키" } } }),
    { formula: "[대상]이 몰랐던 [결과]", copyFormula: "[짧은 질문]?", items: [item("질문"), item("반전"), item("폭로")] }, author, "A");
  assert.deepEqual(plain(saved), { slot: "A", items: 3 });
  assert.equal(written.kind, "make");
  assert.equal(written.data.redo.A.by, "리키");
  assert.equal(written.data.redo.A.copyFormula, "[짧은 질문]?");
  assert.equal(written.data.redo.A.items.length, 3);
  assert.equal(written.data.edits.B.title, "남은 칸");
  assert.equal(written.data.edits.A, undefined);
});

test("the video goes out with the edited A title and copy", () => {
  const edited = state("make", { edits: { A: { title: "회사가 싫은 걸까", copy: "일이 싫은 걸까", reason: "질문형", at: now, by: "리키" } } });
  assert.equal(ai.v1Title(ai.v1Stages(edited)), "회사가 싫은 걸까");
  assert.equal(ai.v1KitCardInputs(edited).thumbnailCopy, "일이 싫은 걸까");
  assert.equal(ai.v1Title(ai.v1Stages(state("make"))), "퇴사 전에 이것부터");
});
