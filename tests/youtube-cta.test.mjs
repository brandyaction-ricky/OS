import assert from "node:assert/strict";
import test from "node:test";
import { ctaPlan, ctaPreview, ctaQuota, ctaUndoable } from "../lib/youtube-process/cta.ts";

const old = "https://myin.kr/r/old";
const videos = [
  { id: "a", title: "연봉", publishedAt: "2026-10-20T00:00:00Z", description: `소개\n-----\n⬇️ 내 기질 진단 받기\n${old}\n이어서 보면 좋을 영상\nhttps://youtu.be/x` },
  { id: "b", title: "강점", publishedAt: "2026-10-28T00:00:00Z", description: `⬇️ 진단\n${old}\n고정 링크 ${old}` },
  { id: "c", title: "다른 영상", publishedAt: "2026-10-29T00:00:00Z", description: "링크 없음" },
];

test("the preview lists only videos with the old words, newest first, with the words around the change", () => {
  const rows = ctaPreview(videos, old, "https://myin.kr/r/new");
  assert.deepEqual(rows.map(row => [row.id, row.count]), [["b", 2], ["a", 1]]);
  assert.match(rows[1].before, /내 기질 진단 받기 \[https:\/\/myin\.kr\/r\/old\] 이어서/);
  assert.match(rows[1].after, /\[https:\/\/myin\.kr\/r\/new\]/);
  assert.equal(ctaQuota(rows.length), 100);
});

test("a plan replaces every match and refuses what YouTube would not take", () => {
  assert.deepEqual(ctaPlan("a x b x", "x", "y"), { next: "a y b y", count: 2 });
  assert.deepEqual(ctaPlan("abc", "", "y"), { problem: "찾을 말을 써 주세요" });
  assert.deepEqual(ctaPlan("abc", "z", "y"), { problem: "찾을 말이 없어요" });
  assert.match(ctaPlan("x", "x", "가".repeat(5001)).problem, /5,000자를 넘어요/);
});

test("undo puts back only a description nobody changed since", () => {
  const item = { videoId: "a", title: "t", before: "old", after: "new", ok: true };
  assert.equal(ctaUndoable("new", item), true);
  assert.equal(ctaUndoable("new and edited", item), false);
  assert.equal(ctaUndoable("new", { ...item, undone: true }), false);
  assert.equal(ctaUndoable("new", { ...item, ok: false }), false);
});
