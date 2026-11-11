import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// 덱 배치 로직 v2 (2026-11-10 request): the storyboard card, the render PC's timing check and the ③ 정지 그림 영상.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const plain = ["python3", "python"].find((name) => spawnSync(name, ["-c", "pass"]).status === 0);

test("the card puts the deck rules first, drops the half-diagrams default and names the full relation table as an optional read", () => {
  const job = read("lib/server/myin-storyboard-job.ts");
  const docs = job.slice(job.indexOf("export const MYIN_CARD_DOCS"), job.indexOf("export const MYIN_CARD_REFERENCE_DOCS"));
  const titles = [...docs.matchAll(/^  \["([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(titles.slice(0, 2), ["마이인 덱 배치 기준 v2 (로건 원문)", "도식 뜻 관계표 — 요약·역표 (로건 원문)"]);
  assert.ok(titles.includes("마이인 예시 기획표 v2 — 낮은 자존감 (로건 원문)"));
  assert.ok(!titles.some((title) => /남들보다 v11/.test(title)));
  assert.doesNotMatch(job, /절반 이상을 도식|50% 아래면/);
  assert.match(job, /"beat"\(비트 번호, 1부터, 줄지 않게\)와 "why"/);
  // The full relation table is named with its id but is not on the must-read list.
  assert.match(job, /필요할 때만 여는 참고 문서\(도식 하나의 자세한 뜻\):\n\$\{MYIN_CARD_REFERENCE_DOCS\.map/);
  assert.match(read("lib/server/youtube-ai-jobs.ts"), /docIds: await myinCardDocIds\(\[\.\.\.MYIN_CARD_DOCS, \.\.\.MYIN_CARD_REFERENCE_DOCS\]\)/);
  // A new storyboard is checked with the deck rules, and an end before the last word follows the voice.
  assert.match(job, /checkMyinStoryboard\(story, words, catalogTypes, speech, \{ deck: true \}\)/);
  assert.match(job, /story\.end < last \+ 0\.5/);
});

test("the render PC times each cut with the engine's scene times and names the storyboard's scene", { skip: !plain && "needs python3" }, () => {
  const code = `
import sys, json; sys.path.insert(0, "tools")
import myin_frame_check as F
words = [[0.0, 0.5, "오늘은"], [0.6, 1.0, "이야기"], [5.0, 5.4, "첫째는"], [6.0, 6.5, "보고서"], [12.0, 12.4, "둘째는"], [13.0, 13.5, "점심"], [14.0, 14.4, "셋째는"], [20.0, 20.5, "끝"]]
plan = [{"type": "opening", "at": "오늘은"}, {"type": "statement", "at": "오늘은"}, {"type": "lib_stage_rooms", "at": "첫째는"},
        {"type": "situation", "at": "둘째는"}, {"type": "statement", "at": "셋째는"}, {"type": "outro", "at": "끝"}]
scenes = [dict(plan[0], t0=0.0), dict(plan[1], t0=0.1, lines=[[["오늘은", 0.1]]]), dict(plan[2], t0=7.2, beats=[{"t": 7.4}]),
          dict(plan[3], t0=12.0, photo={"t": 13.6}), dict(plan[4], t0=14.0, lines=[[["셋째는", 14.0]]])]
idx = F.align(scenes, plan)
print(json.dumps(idx))
print(json.dumps(F.timing(scenes, plan, idx, words, 20.0, lambda t: t, 1), ensure_ascii=False))`;
  const run = spawnSync(plain, ["-I", "-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const [idx, timed] = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(idx, [0, 1, 2, 3, 4], "the outro the engine left out does not shift the others");
  const kinds = timed.map(([j, kind]) => `${j}:${kind}`);
  assert.ok(kinds.includes("2:late"), "the rooms come 2.2 s after 「첫째는」");
  assert.ok(kinds.includes("3:empty"), "the photo comes 1.6 s after its scene starts");
  assert.ok(kinds.includes("3:short"), "the photo scene lasts 2 s");
  assert.ok(!kinds.some((k) => k.startsWith("1:")), "the deck the engine made from the opening is the opening");
  const check = read("tools/myin_frame_check.py");
  assert.match(check, /no = lambda j: 1 if j <= decks else j - decks \+ 1/);
  assert.match(read("lib/server/myin-run.ts"), /\/못 찾음\|빈 화면\|그리기 오류\|늦게 바뀜\|초 미만 장면\/\.test\(line\)/);
});

test("③'s pictures carry no baked subtitle: the editor gets them bare, the 정지 그림 영상 gets the engine's subtitle box and the voice", () => {
  const v0 = read("tools/myin_v0.py");
  assert.match(v0, /subs, M\.SUBS = list\(M\.SUBS\), \[\]/);
  assert.match(v0, /"video": "video\.mp4", "video_ns": "video_ns\.mp4", "proxy": "video_ns\.mp4"/);
  assert.match(v0, /M\.draw_sub\(im, M\.src_time\(mid\), M\.scene_bg\(sc\[k\]\)\)/);
  assert.match(read("lib/server/myin-run.ts"), /stills: run\.stills && record\.parent_id \? await import\("\.\/myin-edit"\)/);
  assert.match(read("components/myin-v13-panel.tsx"), /정지 그림 영상 · 목소리와 자막/);
});
