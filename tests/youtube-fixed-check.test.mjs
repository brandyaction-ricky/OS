import assert from "node:assert/strict";
import test from "node:test";
import { fixedInVersion, fixedSpot } from "../lib/youtube-process/fixed-check.ts";
import { alignVersions, srtCues } from "../lib/youtube-process/compare.ts";

const item = (id, extra) => ({ id, target: "video", status: "done", fixedIn: 6, ver: 4, kind: "", text: "자막을 고쳐 주세요", t: 30, range: null, ...extra });

test("이번 수정 확인 lists only earlier comments fixed in this version, in version and time order", () => {
  const rows = [item("late", { t: 90 }), item("early", { t: 10 }), item("v5", { ver: 5, t: 5 }),
    item("open", { status: "open", fixedIn: null }), item("other", { fixedIn: 5 }), item("same", { ver: 6 }), item("thumb", { target: "A" }),
    item("gone", { deleted: true }), item("like", { reaction: true }), item("notice", { kind: "알림" })];
  assert.deepEqual(fixedInVersion(rows, 6).map(row => row.id), ["early", "late", "v5"]);
  assert.deepEqual(fixedInVersion(rows, 7), []);
});

test("an old time follows the lines both versions share; a cut scene lands where the video continues; no shared lines needs a look", () => {
  const cue = (n, start, text) => `${n}\n00:00:${String(start).padStart(2, "0")},000 --> 00:00:${String(start + 2).padStart(2, "0")},000\n${text}\n`;
  const v4 = [cue(1, 0, "첫 문장"), cue(2, 10, "잘린 장면"), cue(3, 20, "가운데 문장"), cue(4, 40, "끝 문장")].join("\n");
  const v6 = [cue(1, 0, "첫 문장"), cue(2, 12, "가운데 문장"), cue(3, 32, "끝 문장")].join("\n");
  const { anchors } = alignVersions(srtCues(v4), srtCues(v6));
  assert.deepEqual(fixedSpot(20, anchors, 60), { at: 12, sure: true }, "the same line moved 8 s earlier after the cut");
  const cut = fixedSpot(10, anchors, 60);
  assert.ok(cut.sure && cut.at > 0 && cut.at < 12, "the cut scene's time lands between the lines around it");
  assert.deepEqual(fixedSpot(25, [], 60), { at: 25, sure: false });
  assert.deepEqual(fixedSpot(25, null, 60), { at: 25, sure: false });
});
