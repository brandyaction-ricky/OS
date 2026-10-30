import assert from "node:assert/strict";
import test from "node:test";
import { lateMakeOk } from "../lib/youtube-process/stages.ts";

// 업로드 전 급한 수정 (로건 요청 2026-10-30): after the 최종 검토 컨펌 a new final or thumbnail file still goes in until the video is on YouTube.
test("after the 최종 검토 컨펌 only new final and thumbnail files go in, and only before the YouTube upload", () => {
  const final = { addFinal: { path: "p/final/v5.mp4", name: "v5.mp4", bytes: 1 } };
  assert.equal(lateMakeOk("upload", false, final), true);
  assert.equal(lateMakeOk("upload", false, { thumb: { slot: "A", path: "p/thumb/a.png", name: "a.png" }, pair: undefined }), true);
  assert.equal(lateMakeOk("upload", true, final), false);
  assert.equal(lateMakeOk("upload", false, { ...final, pair: { slot: "A", title: "새 제목", copy: "", reason: "급함" } }), false);
  assert.equal(lateMakeOk("upload", false, { editDue: "2026-11-01" }), false);
  assert.equal(lateMakeOk("done", false, final), false);
});
