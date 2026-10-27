import assert from "node:assert/strict";
import test from "node:test";
import { checkMyinStoryboard, myinCreditsBlock, myinPhotoFetchUrl, myinPhotoFolders, myinVisualShare, seqRatio } from "../lib/myin-storyboard.ts";

// The OS check must say what Logan's resolve() says: exact phrase within its window, else a window with difflib ratio ≥ 0.62.
test("seqRatio equals Python difflib.SequenceMatcher.ratio()", () => {
  // Values printed by Python 3 difflib for the same pairs.
  assert.equal(seqRatio("밑이멀쩡하고", "밑이멀정하고").toFixed(6), "0.833333");
  assert.equal(seqRatio("가나다라마바", "바마라다나가").toFixed(6), "0.166667");
  assert.equal(seqRatio("abcde", "abxde").toFixed(6), "0.800000");
});

const words = "오늘은 성격 이야기를 해볼게요 같은 성격인데 자리만 바꿨더니 팀 전체 약점이 사라졌어요 마지막으로 정리해 볼게요 구독 부탁드려요"
  .split(" ").map((word, i) => [i, i + 0.9, word]);
const story = (scenes, cta = [{ after: "자리만 바꿨더니", line: "구독 눌러 주세요" }]) => ({ end: 30, scenes, cta });
const frame = [{ type: "opening", at: "오늘은 성격" }, { type: "hero", at: "같은 성격인데", title: [[["자리만", "자리만 바꿨더니"]]], photo: { file: "situ_a.jpg" } },
  { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25 }, { type: "endscreen", at_time: 28 }];

test("a storyboard whose phrases are all in the transcription passes", () => {
  const result = checkMyinStoryboard(story(frame), words);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.fuzzy, []);
});

test("a cue nowhere in the transcription comes back as 문구 못 찾음; a near spelling is only a note", () => {
  const broken = frame.map((sc) => sc.type === "hero" ? { ...sc, rows: [{ text: "x", cue: "전혀 없는 문장입니다" }, { text: "y", cue: "팀 전체 약점이 사라졋어요" }] } : sc);
  const result = checkMyinStoryboard(story(broken), words);
  assert.deepEqual(result.issues, ["[장면 2] 문구 못 찾음: 전혀 없는 문장입니다"]);
  assert.deepEqual(result.fuzzy, ["[장면 2] 팀 전체 약점이 사라졋어요"]);
});

test("the frame scenes are required", () => {
  const withoutSummary = frame.map((sc) => sc.type === "summary" ? { type: "statement", at_time: 25 } : sc);
  const result = checkMyinStoryboard(story(withoutSummary), words);
  assert.ok(result.issues.includes("summary 장면이 없습니다."));
});

test("myinCreditsBlock drops file names and angle brackets, and is empty without credits", () => {
  assert.equal(myinCreditsBlock([]), "");
  assert.equal(myinCreditsBlock(["situ_a.jpg — Unsplash · Kim · Unsplash License · https://unsplash.com/photos/x", 'music_b.mp3 — "Intro" by <alex>. https://pixabay.com/music/y/']),
    '\n\n사진·음악 출처\n- Unsplash · Kim · Unsplash License · https://unsplash.com/photos/x\n- "Intro" by alex. https://pixabay.com/music/y/');
});

// 로건 운영 시험 (2026-10-23) 기본값: 본문 장면 절반 이상이 도식 · 이미지, 같은 무대는 2번까지 · 연달아 금지.
test("half the body scenes must be diagrams or images, and a stage is used at most twice and never back to back", () => {
  const body = (types) => story([{ type: "opening", at: "오늘은 성격" }, ...types.map((type) => ({ type, at: "같은 성격인데" })),
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25 }, { type: "endscreen", at_time: 28 }]);
  const wordy = checkMyinStoryboard(body(["statement", "hero", "steps", "lib_stage_road"]), words);
  assert.ok(wordy.issues.some((issue) => /본문 4개 중 1개\(25%\)/.test(issue)));
  // (Cue placement and the catalog are checked elsewhere; only the share and reuse rules matter here.)
  const rule = (issue) => /도식 · 이미지|무대/.test(issue);
  assert.deepEqual(checkMyinStoryboard(body(["statement", "lib_stage_road", "iceberg", "hero"]), words, ["lib_stage_road"]).issues.filter(rule), []);
  const reuse = checkMyinStoryboard(body(["lib_stage_road", "lib_stage_road", "hero", "lib_stage_road", "lib_stage_fork"]), words, ["lib_stage_road", "lib_stage_fork"]).issues;
  assert.ok(reuse.some((issue) => /연달아/.test(issue)));
  assert.ok(reuse.some((issue) => /3번 썼어요/.test(issue)));
  // The approved 퇴사 전 순서 storyboard (2026-10-25): 32 body scenes, 20 stage diagrams.
  assert.deepEqual(myinVisualShare([{ type: "opening" }, ...Array.from({ length: 20 }, () => ({ type: "lib_stage_x" })), ...Array.from({ length: 12 }, () => ({ type: "statement" })), { type: "outro" }]), { body: 32, visual: 20 });
});

// 로건 피드백 A-10: the v13 puzzle's word must be set (empty shows 「조건」), and pieces and word stay within 4 letters.
test("a puzzle needs its word and keeps pieces and word to 4 letters", () => {
  const puzzle = (extra) => story([{ type: "opening", at: "오늘은 성격" }, { type: "puzzle", at: "같은 성격인데", pieces: [{ text: "일" }, { text: "역할" }], ...extra },
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25 }, { type: "endscreen", at_time: 28 }]);
  const of = (extra) => checkMyinStoryboard(puzzle(extra), words).issues.filter((issue) => issue.includes("퍼즐"));
  assert.match(of({})[0], /word, 4자 이하.*「조건」/);
  assert.deepEqual(of({ word: "맞는 일" }), []);
  assert.match(of({ word: "맞는 일자리" })[0], /4자 이하로 줄여/);
  assert.match(of({ word: "조합", pieces: [{ text: "일하는 방식" }] })[0], /조각 「일하는 방식」/);
});

// 2026-10-26: Unsplash page downloads got 429 on the render PC; the owner chose file links only, so a page link is refused up front.
test("myinPhotoFetchUrl takes the image hosts' file links as they are and refuses Unsplash photo pages", () => {
  for (const link of ["https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1920&fm=jpg", "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg"])
    assert.equal(myinPhotoFetchUrl(link), link);
  assert.equal(myinPhotoFetchUrl("https://commons.wikimedia.org/wiki/File:Example.jpg"), "https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg");
  for (const link of ["https://unsplash.com/photos/green-hills-1Z2niiBPg5A", "http://images.unsplash.com/photo-1", "https://www.pexels.com/photo/1/", "not a url"])
    assert.equal(myinPhotoFetchUrl(link), null);
});

// 2026-10-26: a situations photo used as a scene's side photo was saved under assets/situations, and Logan's engine looked in
// assets/people (FileNotFoundError, v13 preview stopped three times).
test("myinPhotoFolders puts a scene photo in people and an opening image in situations, whatever the asset kind", () => {
  const story = { scenes: [
    { type: "opening", acts: [{ image: "moving_boxes.jpg" }, { image: "journal_writing.jpg" }] },
    { type: "statement", photo: { file: "night_desk_headache.jpg", t: "x" } },
    { type: "situation", photo: { file: "office_thinking.jpg", kind: "situation", t: "y" } },
    { type: "hero", photo: { file: "journal_writing.jpg", t: "z" } },
  ], music_cues: { a: { file: "music_C2_curious.mp3" } } };
  assert.deepEqual(Object.fromEntries(myinPhotoFolders(story)), {
    "moving_boxes.jpg": ["situations"], "journal_writing.jpg": ["situations", "people"], "night_desk_headache.jpg": ["people"], "office_thinking.jpg": ["people"] });
});
