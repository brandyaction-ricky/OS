import assert from "node:assert/strict";
import test from "node:test";
import { alignVersions, mapTime, srtCues } from "../lib/youtube-process/compare.ts";

const srt = (cues) => cues.map(([from, to, text], i) => `${i + 1}\n00:00:${String(from).padStart(2, "0")},000 --> 00:00:${String(to).padStart(2, "0")},500\n${text}\n`).join("\n");

test("a version with a changed line keeps the shared lines as anchors and lists the change with both times", () => {
  const a = srtCues(srt([[0, 2, "연봉 보고 옮겼는데"], [3, 5, "또 힘들다면"], [6, 8, "이유는 하나예요"], [9, 11, "끝까지 보세요"]]));
  const b = srtCues(srt([[0, 2, "연봉 보고 옮겼는데"], [3, 5, "새로 넣은 비유 장면"], [6, 9, "조금 길어진 설명"], [12, 14, "이유는 하나예요"], [15, 17, "끝까지 보세요."]]));
  assert.equal(a[1].start, 3); assert.equal(a[1].end, 5.5);
  const { anchors, changes } = alignVersions(a, b);
  assert.deepEqual(anchors, [[0, 0], [6, 12], [9, 15]]);
  assert.deepEqual(changes, [{ a: [3, 5.5], b: [3, 9.5], aText: "또 힘들다면", bText: "새로 넣은 비유 장면 조금 길어진 설명" }]);
  // B follows A piece by piece: 6초 later after the change, the same gap before it, straight lines in between.
  assert.equal(mapTime(0, anchors, 0, 30), 0);
  assert.equal(mapTime(10, anchors, 0, 30), 16);
  assert.equal(mapTime(3, anchors, 0, 30), 6);
  assert.equal(mapTime(20, anchors, 0, 30), 26);
  assert.equal(mapTime(20, anchors, 0.5, 26), 26);
});

test("lines only one side has are a point on the other side", () => {
  const a = srtCues(srt([[0, 2, "하나"], [3, 5, "셋"]]));
  const b = srtCues(srt([[0, 2, "하나"], [3, 5, "둘"], [6, 8, "셋"]]));
  assert.deepEqual(alignVersions(a, b).changes, [{ a: [3, 3], b: [3, 5.5], aText: "", bText: "둘" }]);
  assert.deepEqual(alignVersions(b, a).changes, [{ a: [3, 5.5], b: [3, 3], aText: "둘", bText: "" }]);
  // No subtitles: no anchors, B is A plus the offset.
  assert.equal(mapTime(7, [], 2, 60), 9);
});
