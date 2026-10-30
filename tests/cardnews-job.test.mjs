import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as formats from "../lib/cardnews/formats.ts";
import * as confirm from "../lib/youtube-process/confirm.ts";
import * as project from "../lib/youtube-process/project.ts";

// 카드뉴스 초안 (설계서 2026-10-30 §4-2): the job card is written from the format list, and nothing over a limit is saved.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-process-card-job.ts", import.meta.url), "utf8");
let stored = { id: "cards", version: 1, data: { source: { kind: "none", title: "", text: "", at: "" }, focus: "", drafts: [], picked: "" } };
let conflicts = 0;
const modules = { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/cardnews/formats": formats, "@/lib/youtube-process/confirm": confirm, "@/lib/youtube-process/project": project,
  "./youtube-process-stages": {
    readStages: async () => ({ cards: structuredClone(stored) }),
    writeStage: async (_supabase, _owner, _team, _project, kind, current, data) => {
      assert.equal(kind, "cards");
      if (conflicts) { conflicts--; throw new ApiError(409, "RECORD_VERSION_CONFLICT", "conflict"); }
      stored = { id: current.id, version: current.version + 1, data };
      return { id: current.id, version: stored.version };
    },
  } };
const compiled = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => modules[name] });
const job = compiled.exports;

const quote = (text = "버티는 힘이 약한 게 아니라 버틸 이유가 안 보이는 거예요") => ({ format: "quote", caption: "이유가 보이면 덜 지쳐요.", hashtags: ["#직장인", "커리어", "번아웃"],
  slides: [{ type: "cover", fields: { head: "월요일이 유난히 무거운 이유" } }, ...[1, 2, 3, 4].map(n => ({ type: "line", fields: { text: `${text} ${n}` } })),
    { type: "end", fields: { line: "저장해 두고 다시 봐요", action: "프로필에서 보기" } }] });

test("the format text comes from the format list, field by field", () => {
  const text = job.cardFormatSpec(["list", "myth"]);
  for (const id of ["list", "myth"]) for (const spec of formats.CARD_FORMATS[id].slides) for (const field of spec.fields)
    assert.ok(text.includes(`${field.key}(${field.label}, ${field.max}자까지`), `${id}.${spec.type}.${field.key}`);
  assert.match(text, /format: "list"/); assert.doesNotMatch(text, /format: "quote"/);
});

test("the card lists the 정본 by doc_id (GPT pastes it in from there) and the source as data", () => {
  const card = job.cardJobCard({ project: { title: "주제", yp: { topic: { target: "3년 차", note: "" } } }, cards: { source: { kind: "threads", title: "글", text: "원문" }, focus: "" },
    formats: ["quote"], canon: { id: "11111111-2222-4333-8444-555555555555" }, voice: [], leaseMinutes: 30 });
  assert.match(card, /doc_id: 11111111-2222-4333-8444-555555555555/);
  assert.match(card, /"text": "원문"/);
  assert.match(card, /무료 진단/);
  assert.equal(job.canonVersion("> **정본 묶음: v0.1 (2026-10-30).**", 4), "v0.1");
  assert.equal(job.canonVersion("정본 묶음 줄 없음", 4), "doc v4");
});

test("a field over its limit, a missing format or an unknown field comes back with every problem", () => {
  const long = quote("가".repeat(60));
  assert.throws(() => job.checkCardResult({ recommend: { formats: ["quote"], why: "" }, drafts: [long] }, ["quote"]),
    (error) => error.status === 422 && /넘쳐요/.test(error.message) && (error.message.match(/넘쳐요/g) ?? []).length === 4);
  assert.throws(() => job.checkCardResult({ recommend: { formats: [], why: "" }, drafts: [quote()] }, ["quote", "list"]), (error) => error.status === 422 && /정리형\(list\)/.test(error.message));
  const extra = quote(); extra.slides[0].fields.emoji = "x";
  assert.throws(() => job.checkCardResult({ recommend: { formats: [], why: "" }, drafts: [extra] }, ["quote"]), (error) => /없는 칸 "emoji"/.test(error.message));
  const ok = job.checkCardResult({ recommend: { formats: ["quote", "nope", "quote"], why: " 짧은 문장 " }, drafts: [quote()] }, ["quote"]);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.recommend)), { formats: ["quote"], why: "짧은 문장" });
  assert.deepEqual([...ok.drafts[0].hashtags], ["직장인", "커리어", "번아웃"]);
});

test("new drafts are added beside the others, the first is picked, and at most 12 stay", async () => {
  const author = { by: "리키", model: "gpt-6.1-sol", jobId: "job", canon: "v0.1" };
  const result = job.checkCardResult({ recommend: { formats: ["quote"], why: "" }, drafts: [quote()] }, ["quote"]);
  conflicts = 1;
  const saved = await job.saveCardDrafts(null, "owner", "", {}, result, author);
  assert.equal(stored.data.drafts.length, 1);
  assert.equal(stored.data.picked, saved.picked);
  assert.equal(stored.data.drafts[0].ai.sig, formats.cardSignature(result.drafts[0]));
  assert.equal(stored.data.drafts[0].ai.canon, "v0.1");
  // A PD-made draft and the picked one survive; the oldest unpicked AI drafts make room.
  const mine = { ...formats.emptyCardDraft("list", "mine", "PD", "t"), at: "t" };
  stored.data.drafts = [stored.data.drafts[0], mine, ...Array.from({ length: 10 }, (_, n) => ({ ...stored.data.drafts[0], id: `old${n}` }))];
  await job.saveCardDrafts(null, "owner", "", {}, result, author);
  const ids = stored.data.drafts.map(draft => draft.id);
  assert.equal(ids.length, 12);
  assert.ok(ids.includes(saved.picked) && ids.includes("mine") && !ids.includes("old0"));
});
