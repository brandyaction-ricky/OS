import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 사진 칸 영상 클립 (로건 요청 dc9bb251, 2026-11-17): a scene's photo slot takes an MP4 · MOV clip; the engine (render PC package) draws
// its frame at that moment and lays its sound under the voice. The OS takes the upload and tells the staff AI it may use one.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("a photo slot takes a clip: MP4 · MOV up to 20 MB, the editor's own pictures stay images", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /const OUR_PHOTO_TYPES: Record<string, string> = \{ \.\.\.OUR_IMAGE_TYPES, "video\/mp4": "mp4", "video\/quicktime": "mov" \};/);
  const upload = run.slice(run.indexOf("export async function myinOurImageUpload"), run.indexOf("export async function saveMyinOurImage"));
  assert.match(upload, /const ext = OUR_PHOTO_TYPES\[type\];/);
  const editor = run.slice(run.indexOf("export async function myinEditorImageUpload"), run.indexOf("export async function myinEditorImageSize"));
  assert.match(editor, /const ext = OUR_IMAGE_TYPES\[type\];/, "the editor's pictures are not clips");
  assert.match(run, /const OUR_IMAGE_MAX_BYTES = 20 \* 1024 \* 1024;/);
  const panel = read("components/myin-our-images.tsx");
  assert.match(panel, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/quicktime"/);
  assert.match(panel, /이미지 · 영상 올리기/);
});

test("the staff AI is told when a clip fits and how to name it", () => {
  const job = read("lib/server/myin-storyboard-job.ts");
  assert.match(job, /움직임이 핵심인 상황 장면[^\n]*ours_로 시작해 \.mp4로 끝나게[^\n]*"audio"\(0~1, 기본 1, 0이면 끔\)/);
});
