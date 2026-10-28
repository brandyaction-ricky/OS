import assert from "node:assert/strict";
import test from "node:test";
import { diagramCatalogCardSection, diagramCatalogSchema, diagramCatalogTypes, parseSavedDiagramCatalog } from "../lib/diagram-catalog.ts";
import { checkMyinStoryboard } from "../lib/myin-storyboard.ts";

// One item per kind, shaped like tools/myin-diagram-catalog.py prints them on the render PC.
const catalog = diagramCatalogSchema.parse({ engine: "python", package: "pkg", items: [
  { type: "lib_stage_road", name: "길 무대 (지점·막힘·돌아가기·도착)", kind: "stage", when: "문단 하나를 길로 따라간다", slots: "beats 문장 2~8개 · text 지점 이름 2~6자",
    example: { type: "lib_stage_road", theme: "myin", beats: [{ cue: "(대본 문구)", do: "add", id: "a", text: "입사" }] } },
  { type: "lib_lighthouse", name: "등대 (기준이 비추는 곳)", kind: "single", when: "「내 기준이 ~를 비춘다」", slots: "label 2~6자" },
  { type: "lib_row_contrast", name: "행대비", kind: "info", when: "「A가 아니라 B」", slots: "a ≤ 8자, b ≤ 8자" },
  { type: "lib_melt", name: "녹아내림", kind: "poster", when: "「~이 녹아 사라진다」", slots: "text ≤ 4자" },
] });

test("the card lists every reported type under its kind, with the stage example in cue form", () => {
  const card = diagramCatalogCardSection(catalog);
  for (const type of diagramCatalogTypes(catalog)) assert.ok(card.includes(`- ${type} · `), type);
  assert.ok(card.includes("무대형") && card.includes("포스터형"));
  assert.ok(card.includes('"cue":"(대본 문구)"'));
});

test("the catalog accepts only lib_ types and the four kinds", () => {
  assert.equal(diagramCatalogSchema.safeParse({ engine: "python", package: "", items: [{ type: "iceberg", name: "빙산", kind: "single", when: "", slots: "" }] }).success, false);
  assert.equal(diagramCatalogSchema.safeParse({ engine: "python", package: "", items: [{ type: "lib_x", name: "x", kind: "other", when: "", slots: "" }] }).success, false);
  assert.deepEqual(diagramCatalogTypes(null), []);
});

const words = "오늘은 성격 이야기를 해볼게요 처음엔 누구나 회사 안에서 길을 걷기 시작해요 마지막으로 정리해 볼게요".split(" ").map((word, i) => [i, i + 0.9, word]);
const story = (middle) => ({ end: 30, cta: [{ after: "처음엔 누구나", line: "구독 눌러 주세요" }], scenes: [
  { type: "opening", at: "오늘은 성격" }, middle, { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }] });

test("a reported lib_ type passes and its beats' cues are checked like any cue", () => {
  const ok = checkMyinStoryboard(story({ type: "lib_stage_road", at: "처음엔 누구나", theme: "myin", beats: [{ cue: "회사 안에서", do: "add", id: "a", text: "입사" }] }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.notes, []);
  const missing = checkMyinStoryboard(story({ type: "lib_stage_road", at: "처음엔 누구나", beats: [{ cue: "없는 문구입니다", do: "add", id: "a" }] }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(missing.issues, ["[장면 2] 문구 못 찾음: 없는 문구입니다"]);
});

test("a lib_ type the render PC did not report blocks; another new type is only a note for Logan", () => {
  const scene = { type: "lib_stage_road", at: "처음엔 누구나" };
  assert.ok(checkMyinStoryboard(story(scene), words).issues.some((issue) => issue.includes("영상 만드는 컴퓨터가 그릴 수 없는 도식")));
  // (A new type with a photo still counts toward the 도식 · 이미지 share.)
  const other = checkMyinStoryboard(story({ type: "spiral", at: "처음엔 누구나", photo: { file: "situ_a.jpg" } }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(other.issues, []);
  assert.equal(other.notes.length, 1);
});

test("the saved catalog file (report plus its time) reads back; an empty or broken one is ignored", () => {
  const saved = parseSavedDiagramCatalog(JSON.stringify({ ...catalog, at: "2026-10-25T04:00:00.000Z" }));
  assert.deepEqual(diagramCatalogTypes(saved), diagramCatalogTypes(catalog));
  assert.equal(saved.at, "2026-10-25T04:00:00.000Z");
  assert.equal(parseSavedDiagramCatalog(JSON.stringify({ engine: "python", package: "", items: [], at: "x" })), null);
  assert.equal(parseSavedDiagramCatalog(JSON.stringify({ engine: "python", package: "", items: [{ type: "iceberg" }] })), null);
});
