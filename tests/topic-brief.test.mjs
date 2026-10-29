import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

async function load(file, modules = {}) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, URL, Date, require: name => {
      assert.ok(name in modules, name); return modules[name];
    } });
  return compiled.exports;
}
const schedule = await load("lib/content-automation-schedule.ts");
const editorial = await load("lib/threads-editorial.ts", { zod, "./http": { ApiError: Error } });
const references = await load("lib/threads-reference.ts", {
  zod, "./http": { ApiError: Error }, "./content-automation-schedule": schedule, "./threads-editorial": editorial,
});
const { getTopicBriefDraft } = await load("lib/topic-brief.ts", { "./threads-reference": references, "./threads-editorial": editorial });
const plain = value => JSON.parse(JSON.stringify(value));
const reference = (changes = {}) => ({
  id: "one", url: "https://example.substack.com/p/work", title: "A work story", koreanTitle: "일이 맞아도 지칠 때",
  platform: "substack", author: "Author", publishedAt: "2026-10-20", observedAt: "2026-10-26T00:00:00Z",
  metrics: Object.fromEntries(["views", "likes", "comments", "reposts"].map(key => [key, { value: null, verified: false }])),
  scene: "저자는 같은 일을 다른 조건에서 해 본 뒤 차이를 비교했다.", readerQuestion: "일이 맞는데 왜 지칠까?",
  addedPerspective: "직무를 바꾸기 전에 지금 지치는 이유를 나눠 본다.",
  summary: "저자가 일하는 조건을 바꿔 본 이야기.", suggestedTopic: "원래 추천한 주제",
  relevanceNote: "일을 바꿔야 할지 고민하는 사람의 다음 선택과 연결된다.",
  audienceNote: "댓글의 독자도 같은 일을 다른 팀에서 해 본 경험을 나눴다.",
  readScope: "full", readNote: "처음부터 끝까지 읽음", capturedBy: "human", ...changes,
});
const topic = (metadata = {}, stage = "candidate") => ({ title: "내가 직접 정한 주제", stage,
  metadata: { editorial_workflow: references.THREADS_REFERENCE_WORKFLOW,
    source: "reference", reference_items: [reference()], brief: {}, channels: [], ...metadata } });

test("untouched reference candidate uses selected title and original notes without inventing facts", () => {
  const source = topic();
  const before = JSON.stringify(source);
  const result = getTopicBriefDraft(source);
  assert.equal(result.seeded, true);
  assert.equal(result.brief.one, source.title);
  assert.equal(result.brief.who, source.metadata.reference_items[0].relevanceNote);
  assert.equal(result.brief.message, source.metadata.reference_items[0].addedPerspective);
  assert.match(result.brief.sources, /https:\/\/example\.substack\.com\/p\/work/);
  assert.match(result.brief.sources, /읽은 범위: 전체 읽음/);
  assert.deepEqual(plain(result.channels), ["threads"]);
  assert.equal(JSON.stringify(source), before);
});

test("saved fields including intentional blanks are never reseeded", () => {
  for (const brief of [{ one: "" }, { who: "내가 쓴 대상", message: "" }, { sources: "내 자료" }]) {
    const result = getTopicBriefDraft(topic({ brief, channels: [] }));
    assert.equal(result.seeded, false);
    for (const key of ["one", "who", "message", "sources", "warn"])
      assert.equal(result.brief[key], brief[key] ?? "");
    assert.deepEqual(plain(result.channels), []);
  }
});

test("a saved or confirmed brief is not filled again even if all fields are absent", () => {
  for (const stage of ["brief", "confirmed", "making", null, undefined]) {
    const source = topic(); source.stage = stage;
    const result = getTopicBriefDraft(source);
    assert.equal(result.seeded, false);
    assert.equal(result.brief.one, "");
  }
});

test("existing channel choices are preserved for both seeded and saved topics", () => {
  assert.deepEqual(plain(getTopicBriefDraft(topic({ channels: ["card", "shorts"] })).channels), ["card", "shorts"]);
  assert.deepEqual(plain(getTopicBriefDraft(topic({ brief: { one: "" }, channels: ["shorts"] })).channels), ["shorts"]);
});

test("direct topics, source collection records, missing and malformed references are not seeded", () => {
  for (const source of [null, undefined, topic({ editorial_workflow: undefined }),
    topic({ kind: references.THREADS_REFERENCE_KIND }), topic({ reference_items: [] }),
    topic({ reference_items: [{ url: "bad" }] }), topic({ brief: null }), topic({ brief: [] })]) {
    assert.equal(getTopicBriefDraft(source).seeded, false);
  }
});

test("multiple reference notes stay separate and source reading limits are not upgraded", () => {
  const result = getTopicBriefDraft(topic({ reference_items: [reference(), reference({ id: "two",
    url: "https://example.substack.com/p/second", koreanTitle: "두 번째 이야기", readScope: "partial",
    relevanceNote: "두 번째 독자 맥락", addedPerspective: "두 번째 관점" })] }));
  assert.match(result.brief.message, /\n\n두 번째 관점$/);
  assert.match(result.brief.sources, /읽은 범위: 일부 읽음/);
  assert.match(result.brief.sources, /https:\/\/example\.substack\.com\/p\/second/);
  assert.ok(!("approved" in result));
});

test("oversize notes use an explicit source pointer instead of truncating an assertion", () => {
  const long = "수정하지 않은 원문의 문장이다. ".repeat(150);
  const many = Array.from({ length: 20 }, (_, index) => reference({ id: String(index),
    url: `https://example.substack.com/p/${index}?source=${"a".repeat(1700)}`,
    addedPerspective: long, relevanceNote: long }));
  const result = getTopicBriefDraft(topic({ reference_items: many }));
  assert.equal(result.seeded, true);
  assert.match(result.brief.message, /선택한 레퍼런스에서 확인/);
  assert.match(result.brief.who, /선택한 레퍼런스에서 확인/);
  assert.match(result.brief.sources, /나머지 원문/);
  assert.ok(result.brief.sources.includes(many[0].url));
  assert.ok(!result.brief.message.includes(long.slice(0, 10)));
  for (const value of Object.values(result.brief)) assert.ok(value.length <= 5000);
  assert.ok(Buffer.byteLength(JSON.stringify({ version: 1, brief: result.brief, channels: { threads: {} }, teamThreads: true })) < 30_000);
});

const editorialTopic = (route = "insight", changes = {}) => ({ title: "예시 주제: 역할이 달라지면 잘하는 일도 달라질까?", stage: "candidate", metadata: {
  editorial_workflow: editorial.THREADS_EDITORIAL_WORKFLOW, editorial_route: route,
  editorial_material: {
    firstParagraph: "같은 업무인데 팀을 옮기고 나서 갑자기 못하는 사람이 됐다. 무엇이 달라진 걸까?",
    readerQuestion: "역할이 달라지면 잘하는 일도 달라질까?", readerContext: "같은 일을 다른 팀에서 해보려는 사람",
    scene: "가상 예시: 작업자는 팀이 바뀐 뒤 같은 일을 다른 순서로 했다.", sceneKind: route === "person" ? "documented" : "hypothetical",
    directAnswer: "일의 이름보다 실제로 맡은 행동을 함께 비교한다.", perspective: "같은 이름의 업무라도 역할의 범위는 다를 수 있다.",
    application: "최근 완료한 일의 실제 작업 순서를 적어본다.", reasonToRead: "같은 일을 옮기면 무엇이 달라지는지 궁금하다.",
    sources: [{ kind: route === "person" ? "public" : "os_document", title: "테스트 원문", url: route === "person" ? "https://example.test/interview" : "https://brandyaction-os.vercel.app/knowledge/doc/00000000-0000-4000-8000-000000000001", locator: "첫 번째 절", evidenceNote: "테스트용 합성 자료. 외부 원문이 아님." }],
    ...(route === "person" ? { personName: "합성 예시 인물", eventDate: "2026-01-01" } : {}),
  }, brief: {}, channels: [], ...changes,
} });

test("insight and person candidates seed their own material and preserve the scene evidence", () => {
  for (const route of ["insight", "person"]) {
    const source = editorialTopic(route), before = JSON.stringify(source), result = getTopicBriefDraft(source);
    assert.equal(result.seeded, true);
    assert.equal(result.brief.one, source.title);
    assert.equal(result.brief.who, source.metadata.editorial_material.readerContext);
    assert.match(result.brief.message, /질문에 대한 답:/);
    assert.match(result.brief.message, /더할 관점:/);
    assert.match(result.brief.sources, route === "person" ? /원문에서 확인한 장면/ : /가상 예시/);
    assert.match(result.brief.sources, /위치: 첫 번째 절/);
    assert.match(result.brief.warn, route === "person" ? /욕구 유형/ : /개인 진단 결과/);
    assert.deepEqual(plain(result.channels), ["threads"]);
    assert.equal(JSON.stringify(source), before);
  }
});

test("new route never replaces a saved edit, nor guesses at malformed or mixed materials", () => {
  assert.equal(getTopicBriefDraft(editorialTopic("insight", { brief: { one: "" } })).seeded, false);
  assert.equal(getTopicBriefDraft(editorialTopic("person", { editorial_material: {} })).seeded, false);
  assert.equal(getTopicBriefDraft(editorialTopic("insight", { reference_items: [reference()] })).seeded, false);
});
