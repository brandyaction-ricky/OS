import assert from "node:assert/strict";
import test from "node:test";
import { diagramCatalogCardSection, diagramCatalogSchema, diagramCatalogTypes } from "../lib/diagram-catalog.ts";
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
  { type: "opening", at: "오늘은 성격" }, middle, { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25 }, { type: "endscreen", at_time: 28 }] });

test("a reported lib_ type passes and its beats' cues are checked like any cue", () => {
  const ok = checkMyinStoryboard(story({ type: "lib_stage_road", at: "처음엔 누구나", theme: "myin", beats: [{ cue: "회사 안에서", do: "add", id: "a", text: "입사" }] }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.notes, []);
  const missing = checkMyinStoryboard(story({ type: "lib_stage_road", at: "처음엔 누구나", beats: [{ cue: "없는 문구입니다", do: "add", id: "a" }] }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(missing.issues, ["[장면 2] 문구 못 찾음: 없는 문구입니다"]);
});

test("a lib_ type the render PC did not report blocks; another new type is only a note for Logan", () => {
  const scene = { type: "lib_stage_road", at: "처음엔 누구나" };
  assert.ok(checkMyinStoryboard(story(scene), words).issues.some((issue) => issue.includes("렌더 PC가 그릴 수 없는 도식")));
  const other = checkMyinStoryboard(story({ type: "spiral", at: "처음엔 누구나" }), words, diagramCatalogTypes(catalog));
  assert.deepEqual(other.issues, []);
  assert.equal(other.notes.length, 1);
});


test("saved catalog survives JSON storage with its timestamp", () => {
  const stored = JSON.parse(JSON.stringify({ ...catalog, at: "2026-10-22T05:00:00.000Z" }));
  const restored = diagramCatalogSchema.parse(stored);
  assert.deepEqual(diagramCatalogTypes(restored), diagramCatalogTypes(catalog));
  assert.equal(restored.at, stored.at);
  assert.equal(diagramCatalogSchema.safeParse({ ...stored, at: "invalid" }).success, false);
});

test("shared diagrams are selected by verified output ratio; legacy reports remain landscape only", () => {
  const shared = diagramCatalogSchema.parse({ ...catalog, items: [
    catalog.items[0],
    { ...catalog.items[1], aspectRatios: ["16:9", "9:16"] },
    { ...catalog.items[2], aspectRatios: ["9:16"] },
  ] });
  assert.deepEqual(diagramCatalogTypes(shared), ["lib_stage_road", "lib_lighthouse"]);
  assert.deepEqual(diagramCatalogTypes(shared, "9:16"), ["lib_lighthouse", "lib_row_contrast"]);
  assert.deepEqual(diagramCatalogTypes(catalog, "9:16"), []);
  const card = diagramCatalogCardSection(shared, "9:16");
  assert.ok(card.includes("2종 · 9:16"));
  assert.ok(!card.includes("lib_stage_road"));
  assert.ok(card.includes("lib_lighthouse") && card.includes("lib_row_contrast"));
  assert.ok(!card.includes("8종 이상"));
});

test("invalid, empty and duplicate aspect-ratio capabilities are rejected", () => {
  for (const aspectRatios of [[], ["1:1"], ["9:16", "9:16"]]) {
    assert.equal(diagramCatalogSchema.safeParse({ ...catalog, items: [{ ...catalog.items[0], aspectRatios }] }).success, false);
  }
});
