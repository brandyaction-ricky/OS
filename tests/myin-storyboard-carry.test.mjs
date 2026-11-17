import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { anchorMyinCues, myinCueMisses, myinCuesAsScript } from "../lib/myin-storyboard.ts";

// 요청 3번 (2026-11-17): an edited script's new voice keeps the video's earlier storyboard; only scenes whose words went away go to the AI.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const said = (line) => line.split(" ").map((w, i) => [i, i + 0.9, w]);

// The same script read twice: the earlier voice was heard 「지렀던」 where the script says 「줄였던」, the new one as written; the phrase
// comes again further on, which is where a cue written as one transcript heard it used to land in the other.
const speech = "#SECTION 1\n그 차이는 각자 겪은 일에서 생겨요. 발표를 줄였던 그 마케터도 처음엔 몰랐어요.\n회의실 공기가 달랐어요. 그 뒤로 발표를 줄였던 날이 많았어요.";
const earlierWords = said("그 차이는 각자 겪은 일에서 생겨요 발표를 지렀던 그 마켓터도 처음엔 몰랐어요 회의실 공기가 달랐어요 그 뒤로 발표를 줄였던 날이 많았어요");
const newWords = said("그 차이는 각자 겪은 일에서 생겨요 발표를 줄였던 그 마켓터도 처음엔 몰랐어요 회의실 공기가 달랐어요 그 뒤로 발표를 줄였던 날이 많았어요");
const lent = () => ({ scenes: [
  { type: "statement", at: "그 차이는" },
  { type: "statement", at: "발표를 지렀던", title: [["발표를 줄였던 마케터", "발표를 지렀던"]] },
  { type: "statement", at: "회의실 공기가" } ], cta: [{ after: "날이 많았어요", line: "구독" }] });

test("cues the earlier voice heard otherwise are written back as the script, then found in the new voice at their own place", () => {
  const story = lent();
  const script = myinCuesAsScript(story, earlierWords, speech);
  assert.equal(script.scenes[1].at, "발표를 줄였던", "written back as the script spells that place");
  assert.equal(script.scenes[1].title[0][1], "발표를 줄였던");
  assert.equal(script.scenes[1].title[0][0], "발표를 줄였던 마케터", "shown text never changes");
  assert.equal(script.scenes[2].at, "회의실 공기가", "a cue heard as written stays");
  assert.equal(story.scenes[1].at, "발표를 지렀던", "the storyboard handed in is not changed in place");
  const { storyboard } = anchorMyinCues(script, newWords, speech);
  const found = myinCueMisses(storyboard, newWords);
  assert.deepEqual([found.misses, found.fuzzy], [[], []]);
  // Taken over as it was, the misheard cue is at best found by a near match.
  const raw = myinCueMisses(story, newWords);
  assert.ok(raw.misses.length + raw.fuzzy.length > 0, JSON.stringify(raw));
});

test("a cue found again further on is anchored where the script puts it, not at the later repeat", () => {
  // The script's 「발표를 줄였던」 at the first place is heard 「지렀던」; the same words come again in the next paragraph.
  const { storyboard, changed } = anchorMyinCues({ scenes: [{ type: "statement", at: "그 차이는" }, { type: "statement", at: "발표를 줄였던" }, { type: "statement", at: "회의실 공기가" }], cta: [] },
    earlierWords, speech);
  assert.equal(storyboard.scenes[1].at, "발표를지렀던");
  assert.equal(changed.length, 1);
  assert.deepEqual(myinCueMisses(storyboard, earlierWords).misses, []);
  // A cue heard exactly at the place the script puts it stays as written.
  assert.deepEqual(anchorMyinCues({ scenes: [{ type: "statement", at: "발표를 줄였던" }], cta: [] }, newWords, speech).changed, []);
});

test("the new run borrows the storyboard, our images and subtitle edits; an edit's scenes go to the AI, too many and it writes all again", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /async function earlierLoan\(service: Service, record: OsRecord, run: MyinRun,/);
  assert.match(run, /if \(run\.layout \|\| run\.storyboard \|\| run\.subtitleEdits\) return null;/);
  assert.match(run, /\.lt\("created_at", record\.created_at\)\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(run, /changed\.length \* 2 > run\.paragraphs\.length/);
  assert.match(run, /myinCuesAsScript\(await storyboardJson\(service, donor\), earlier\.words, earlier\.speech \?\? ""\)/);
  assert.match(run, /checkMyinStory\(story, bundle\.words, diagramCatalogTypes\(catalog\), bundle\.speech\)/);
  assert.match(run, /if \(scenes\.size > CARRY_SCENES_MAX\) return/);
  assert.match(run, /line\.text === edit\.from|l\.text === edit\.from/);
  assert.match(run, /review: \{ decision: "revise", by: [^}]*name: MYIN_CARRY_NAME/);
  // Words done: the loan first; the AI is asked unless the whole storyboard was lent.
  assert.match(run, /lendStoryboard\(service, saved, loan\)\.catch\(failedLoan\) : null\) !== "whole"\)\s*\n\s*await resendStoryboard\(/);
  assert.match(run, /const carried = value\.carried \?\? \(run\.review\?\.name === MYIN_CARRY_NAME \? run\.storyboard\?\.carried : undefined\);/);
  const job = read("lib/server/myin-storyboard-job.ts");
  assert.match(job, /if \(issues\.length\) throw new ApiError\(422, "MYIN_STORYBOARD_ISSUES"/);
  assert.match(job, /s\.who === "원고 고친 곳"/);
  assert.match(run, /review\.name === MYIN_CARRY_NAME \? `원고를 고친 곳 \$\{review\.scenes\?\.length \?\? 0\}장면만 내 AI가 고쳐요/, "the editor chat's news says so");
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /carry \? "2\/4 장면 기획표 · 원고 고친 장면만 내 AI가 고쳐요"/);
  assert.match(panel, /전 작업 기획표 그대로\(바뀐 문단 \$\{board\.carried\.changed\}개/);
  assert.match(panel, /run\.review\.name === "원고 고친 곳" \? "원고를 고친 곳만 내 AI에게"/);
});
