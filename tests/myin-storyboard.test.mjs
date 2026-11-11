import assert from "node:assert/strict";
import test from "node:test";
import { anchorMyinCues, applyMyinSoundPlan, checkMyinStoryboard, matchingBlocks, myinCueMisses, myinCreditsBlock, myinDriftPairs, myinOnlySoundChanged, myinPhotoFetchUrl, myinPhotoFolders, myinPrepPhotos, myinSoundIssues, myinSoundPlan, myinDeckIssues, seqRatio } from "../lib/myin-storyboard.ts";

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
  { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }];

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

// 덱 배치 기준 v2 (2026-11-10): no share of diagrams and images any more; a stage at most twice and never back to back, except a
// 나열형 기준 판 brought back for its next item (the same rooms, the same ids), which is one board.
test("there is no diagram share; a stage is used at most twice and never back to back, but a 기준 판 brought back counts once", () => {
  const body = (scenes) => story([{ type: "opening", at: "오늘은 성격" }, ...scenes.map((sc) => typeof sc === "string" ? { type: sc, at: "같은 성격인데" } : { at: "같은 성격인데", ...sc }),
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }]);
  const rule = (issue) => /도식 · 이미지|무대/.test(issue);
  assert.deepEqual(checkMyinStoryboard(body(["statement", "hero", "steps", "statement"]), words).issues.filter(rule), []);
  const reuse = checkMyinStoryboard(body(["lib_stage_road", "lib_stage_road", "hero", "lib_stage_road", "lib_stage_fork"]), words, ["lib_stage_road", "lib_stage_fork"]).issues;
  assert.ok(reuse.some((issue) => /연달아/.test(issue)));
  assert.ok(reuse.some((issue) => /3번 썼어요/.test(issue)));
  const room = (text) => ({ type: "lib_stage_rooms", beats: ["r1", "r2", "r3", "r4"].map((id, k) => ({ do: "add", id, text: k < text ? "칸" : "" })) });
  const board = checkMyinStoryboard(body([room(0), room(1), "situation", "lib_row_contrast", room(2), "situation", room(3), room(4)]), words, ["lib_stage_rooms", "lib_row_contrast"]).issues;
  assert.deepEqual(board.filter(rule), []);
});

// 덱 배치 기준 v2: every body scene says its beat and why; beats never go back; an arrow diagram is no plain contrast; a diagram's
// default caption is filled; a screen does not come back one scene later.
test("a new storyboard has a beat and a why on every scene and keeps Logan's deck rules", () => {
  const ok = [{ type: "opening" }, { type: "situation", beat: 1, why: "순간 → 사진", photo: { file: "ours_a.jpg" } },
    { type: "lib_row_contrast", beat: 2, why: "교정 → 행대비 → 속생각을 처방으로", a_cap: "속으로는", b_cap: "하지만" }, { type: "statement", beat: 2, why: "결론 → 큰 글자" }, { type: "outro" }];
  assert.deepEqual(myinDeckIssues(ok), []);
  const bad = myinDeckIssues([{ type: "opening" }, { type: "statement", beat: 2, why: "결론" }, { type: "lib_two_cards", beat: 1, why: "대조 → 2칸카드" },
    { type: "lib_row_contrast", beat: 3 }, { type: "lib_venn2", beat: 3, why: "겹침", label: "A" }, { type: "statement", beat: 3, why: "x" }, { type: "lib_venn2", beat: 3, why: "겹침", label: "A" }]);
  assert.ok(bad.some((i) => /\[장면 3\] beat 1가 앞 장면\(2\)보다 작아요/.test(i)));
  assert.ok(bad.some((i) => /\[장면 3\] why가 「대조」인데 lib_two_cards/.test(i)));
  assert.ok(bad.some((i) => /\[장면 4\] "why"/.test(i)));
  assert.ok(bad.some((i) => /a_cap가 비어 있어 원고에 없는 「흔한 생각」/.test(i)));
  assert.ok(bad.some((i) => /\[장면 5 → 6 → 7\] 같은 화면/.test(i)));
});

// 로건 피드백 A-10: the v13 puzzle's word must be set (empty shows 「조건」), and pieces and word stay within 4 letters.
test("a puzzle needs its word and keeps pieces and word to 4 letters", () => {
  const puzzle = (extra) => story([{ type: "opening", at: "오늘은 성격" }, { type: "puzzle", at: "같은 성격인데", pieces: [{ text: "일" }, { text: "역할" }], ...extra },
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }]);
  const of = (extra) => checkMyinStoryboard(puzzle(extra), words).issues.filter((issue) => issue.includes("퍼즐"));
  assert.match(of({})[0], /word, 4자 이하.*「조건」/);
  assert.deepEqual(of({ word: "맞는 일" }), []);
  assert.match(of({ word: "맞는 일자리" })[0], /4자 이하로 줄여/);
  assert.match(of({ word: "조합", pieces: [{ text: "일하는 방식" }] })[0], /조각 「일하는 방식」/);
});

// 2026-10-28: a scale scene with a label but no title stopped 자료 준비 six times (KeyError 'title' in Logan's s_scale).
test("scenes Logan's engine reads without a fallback must carry those fields", () => {
  const scale = (extra) => story([{ type: "opening", at: "오늘은 성격" }, { type: "scale", at: "같은 성격인데", label: "무게", left: { name: "일", cue: "같은 성격인데" }, right: { name: "역할", cue: "같은 성격인데" }, cue_tilt: "같은 성격인데", ...extra },
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }]);
  const of = (extra) => checkMyinStoryboard(scale(extra), words).issues.filter((issue) => issue.includes("칸이 비었어요"));
  assert.deepEqual(of({}).map((issue) => issue.split(":")[1].trim().split(" ")[0]), ["title"]);
  assert.deepEqual(of({ title: "어느 쪽이 무거울까" }), []);
  assert.equal(of({ title: "무게", cue_tilt: undefined, right: "" }).length, 2);
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

// 로건 「마이인 기획표 QA 기준 v1」 3부 (2026-10-27), from the 연봉 video's QA: the OS refuses what any AI keeps getting wrong.
test("QA: what is lower on the screen never appears before what is above it", () => {
  const hero = (extra) => story([{ type: "opening", at: "오늘은 성격" }, { type: "hero", at: "같은 성격인데", title: [[["자리만", "자리만 바꿨더니"]]], ...extra },
    { type: "outro", at: "마지막으로 정리해" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }]);
  const order = (extra) => checkMyinStoryboard(hero(extra), words).issues.filter((issue) => issue.includes("먼저 떠요"));
  assert.match(order({ sub: { text: "같은 성격", cue: "같은 성격인데" } })[0], /\[장면 2\] 화면 아래 「같은 성격」\(소제목\)가 위 「자리만」\(제목\)보다 먼저 떠요/);
  assert.deepEqual(order({ sub: { text: "약점이 사라짐", cue: "팀 전체" } }), []);
  // A quote's author comes after the quote; a piece without a cue shows at the scene start.
  assert.equal(order({ title: undefined, lines: [{ text: "팀 전체", cue: "팀 전체" }], author: { text: "코치", cue: "자리만 바꿨더니" } }).length, 1);
});

test("QA: every opening sentence has text on screen; a row list with % figures and 「눌러 두」 are refused", () => {
  const speech = "#SECTION 도입\n오늘은 성격 이야기를 해볼게요. 같은 성격인데 자리만 바꿨더니 팀 전체 약점이 사라졌어요.\n#SECTION 끝\n마지막으로 정리해 볼게요. 구독 부탁드려요.";
  const open = (lines) => story([{ type: "opening", at: "오늘은 성격", acts: [{ cue: "오늘은 성격", lines }] }, { type: "outro", at: "마지막으로 정리해" },
    { type: "statement", at: "구독 부탁드려요" }, { type: "summary", at_time: 25, title: "정리", points: [{ head: "자리", desc: "바꾸기" }] }, { type: "endscreen", at_time: 28 }]);
  const gaps = (lines) => checkMyinStoryboard(open(lines), words, [], speech).issues.filter((issue) => issue.startsWith("[오프닝]"));
  assert.match(gaps([[{ text: "성격 이야기", cue: "오늘은 성격" }]])[0], /「같은 성격인데 자리만 바꿨더니/);
  assert.deepEqual(gaps([[{ text: "성격 이야기", cue: "오늘은 성격" }], [{ text: "자리만 바꿨더니", cue: "같은 성격인데" }]]), []);
  const stats = checkMyinStoryboard(story([...frame.slice(0, 2), { type: "lib_numbered", at: "팀 전체", items: [{ text: "직무 53.3%", cue: "팀 전체" }, { text: "회사 30%" }] }, ...frame.slice(2)]), words, ["lib_numbered"]).issues;
  assert.ok(stats.some((issue) => /\[장면 3\] 줄 목록에 % 수치가 2개예요/.test(issue)));
  const cta = checkMyinStoryboard(story(frame, [{ after: "자리만 바꿨더니", line: "구독 한 번 눌러 두고 들어 주세요" }]), words).issues;
  assert.deepEqual(cta.filter((issue) => issue.startsWith("[구독")), ["[구독 1] 「눌러 두…」 대신 「눌러 주세요」로 써요"]);
});

test("myinDriftPairs turns an opening act's bare-number camera drift into the [x, y] pair Logan's engine reads", () => {
  const acts = [{ cue: "a", cam: { push: 0.035, drift: 16 } }, { cue: "b", cam: { drift: [-12, 0] } }, { cue: "c" }];
  const out = myinDriftPairs({ scenes: [{ type: "opening", at: "a", acts }, { type: "hero", at: "b" }] });
  assert.deepEqual(out.scenes[0].acts.map((act) => act.cam?.drift), [[16, 0], [-12, 0], undefined]);
});

// 로건 엔진 v15.3 (2026-10-27): photo.focus_x sets the horizontal crop; both focus values stay within 0–1.
test("photo focus_x and focus_y are numbers between 0 and 1", () => {
  const withPhoto = (photo) => checkMyinStoryboard(story(frame.map((sc) => sc.type === "hero" ? { ...sc, photo } : sc)), words).issues.filter((issue) => issue.includes("photo."));
  assert.deepEqual(withPhoto({ file: "situ_a.jpg", focus_x: 0.8, focus_y: 0.4 }), []);
  assert.deepEqual(withPhoto({ file: "situ_a.jpg", focus_x: 1.5, focus_y: "0.4" }), ["[장면 2] photo.focus_x는 0~1 사이 숫자예요(0.5 = 가운데)", "[장면 2] photo.focus_y는 0~1 사이 숫자예요(0.5 = 가운데)"]);
});

// 사운드 창고 (로건 2026-10-27): ③ writes song · ambience keys into the storyboard, ④ changes them; only the sound fields move.
test("myinSoundPlan reads songs, ambience and effects; applyMyinSoundPlan replaces only those fields", () => {
  const board = { end: 30, cta: [{ after: "자리만 바꿨더니", line: "구독 눌러 주세요" }], music_cues: { C1: { file: "bgm_main.mp3" } }, scenes: [
    { type: "opening", at: "오늘은 성격", music: "C1" },
    { type: "hero", at: "같은 성격인데", title: [[["자리만", "자리만 바꿨더니"]]], music: { key: "music_13", start: 13, why: "통계" }, amb: "amb_cafe", amb_dur: 7.5 },
    { type: "outro", at: "마지막으로 정리해", sfx: [{ cue: "정리해 볼게요", key: "chime_done" }] }] };
  const plan = myinSoundPlan(board);
  assert.deepEqual(plan, { music: [{ scene: 1, key: "C1", start: undefined }, { scene: 2, key: "music_13", start: 13 }],
    amb: [{ scene: 2, key: "amb_cafe", dur: 7.5, cue: undefined, cueEnd: undefined }], sfx: [{ scene: 3, cue: "정리해 볼게요", key: "chime_done" }] });
  const next = applyMyinSoundPlan(board, { music: [{ scene: 1, key: "C1" }, { scene: 3, key: "music_05" }], amb: [], sfx: [{ scene: 2, cue: "자리만 바꿨더니", key: "snap_click" }] });
  assert.equal(next.scenes[0].music, "C1");
  assert.equal(next.scenes[1].music, undefined);
  assert.equal(next.scenes[1].amb, undefined);
  assert.deepEqual(next.scenes[1].sfx, [{ cue: "자리만 바꿨더니", key: "snap_click" }]);
  assert.deepEqual(next.scenes[2].music, { key: "music_05" });
  assert.deepEqual(next.scenes[1].title, board.scenes[1].title);
  assert.equal(board.scenes[1].amb, "amb_cafe");   // the input is not changed
});

test("myinSoundIssues stops keys the render PC lacks and effect lines not heard after their scene starts", () => {
  const catalog = [{ kind: "music", key: "music_05", title: "Daydreamer" }, { kind: "sfx", key: "snap_click", title: "click" }, { kind: "amb", key: "amb_cafe", title: "카페" }];
  const ok = applyMyinSoundPlan(story(frame), { music: [{ scene: 1, key: "music_05" }], amb: [{ scene: 2, key: "amb_cafe", dur: 5 }], sfx: [{ scene: 2, cue: "자리만 바꿨더니", key: "snap_click" }] });
  assert.deepEqual(myinSoundIssues(ok, words, catalog), []);
  const bad = applyMyinSoundPlan(story(frame), { music: [{ scene: 1, key: "music_99" }], amb: [{ scene: 2, key: "amb_moon" }], sfx: [{ scene: 3, cue: "전혀 없는 말", key: "boom" }] });
  const issues = myinSoundIssues(bad, words, catalog);
  assert.equal(issues.length, 4);
  assert.ok(issues.some((issue) => issue.includes("music_99")) && issues.some((issue) => issue.includes("amb_moon")) && issues.some((issue) => issue.includes("boom")) && issues.some((issue) => issue.includes("전혀 없는 말")));
});

// 2026-10-28 유쓰·로건: Logan's music match came back as 「문구 못 찾음」 and stopped ③ on every run with an ambience or a drifting opening.
test("myinOnlySoundChanged keeps Logan's music match, and still tells a rewritten scene apart", () => {
  const ours = { music_cues: { C1: {} }, scenes: [{ type: "opening", at: "a", music: "C1", acts: [{ cam: { drift: 0.4 } }] }, { type: "hero", at: "침대에 누워" }] };
  const matched = { scenes: [{ type: "opening", at: "a", music: { key: "calm_01", start: 2, why: "잔잔" }, acts: [{ cam: { drift: [0.4, 0] } }] },
    { type: "hero", at: "침대에 누워", amb: "amb_bedroom_night", amb_dur: 7.9, amb_off: 4.26, amb_var: 1, amb_db: -54 }] };
  assert.equal(myinOnlySoundChanged(matched, ours), true);
  assert.equal(ours.scenes[0].acts[0].cam.drift, 0.4, "our storyboard is left as it was");
  const rewritten = JSON.parse(JSON.stringify(matched));
  rewritten.scenes[1].at = "퇴근길에";
  assert.equal(myinOnlySoundChanged(rewritten, ours), false);
  rewritten.scenes[1].at = "침대에 누워"; rewritten.scenes[1].type = "photo";
  assert.equal(myinOnlySoundChanged(rewritten, ours), false);
});

// 우리 이미지 올리기 (2026-10-28 대표 · 로건): Logan's own portrait stopped ④ on the render PC because nothing could send it there.
test("myinPrepPhotos sends our uploaded image instead of a listed photo of the same name, into every folder the engine reads it from", () => {
  const folders = myinPhotoFolders({ scenes: [{ type: "photo", photo: { file: "brickman.jpg" } }, { type: "opening", acts: [{ image: "desk.jpg" }] },
    { type: "photo", photo: { file: "desk.jpg" } }, { type: "photo", photo: { file: "page.jpg" } }] });
  const listed = [{ kind: "people", file: "brickman.jpg", url: "https://upload.wikimedia.org/a.jpg" }, { kind: "situations", file: "desk.jpg", url: "https://images.unsplash.com/photo-1" },
    { kind: "people", file: "page.jpg", url: "https://unsplash.com/photos/x" }];
  const ours = { "brickman.jpg": "https://signed/brickman" };
  assert.deepEqual(myinPrepPhotos(folders, listed, () => true, ours), [
    { kind: "situations", file: "desk.jpg", url: "https://images.unsplash.com/photo-1" }, { kind: "people", file: "desk.jpg", url: "https://images.unsplash.com/photo-1" },
    { kind: "people", file: "brickman.jpg", url: "https://signed/brickman" }]);
  // ④: only approved listed photos; ours go regardless.
  assert.deepEqual(myinPrepPhotos(folders, listed, (file) => file === "page.jpg", ours), [{ kind: "people", file: "brickman.jpg", url: "https://signed/brickman" }]);
});

// 로건 개발 문서 v3 7.2-4: cues written as the script spells them are written as the transcript heard them (원고 ↔ 받아쓰기 정렬표).
test("a cue the transcript hears otherwise is anchored to the words it was read as; shown text and exact cues stay", () => {
  const speech = "#SECTION 1\n지안 씨는 좀 굼떠요. 세 가지가 있어요.\n그래서 면담을 했어요.";
  const heard = "지한 씨는 좀 군떠요 3가지가 있어요 그래서 논담을 했어요".split(" ");
  const words = heard.map((w, i) => [i, i + 0.9, w]);
  const story = { scenes: [
    { type: "opening", at: "지안 씨는", lines: [[{ text: "지안 씨는", cue: "지안 씨는" }]] },
    { type: "statement", at: "세 가지가", title: [["세 가지", "세 가지가"]], cue_b: "있어요" },
    { type: "statement", at: "그래서 면담을" } ], cta: [{ after: "면담을 했어요", line: "구독" }] };
  const before = myinCueMisses(story, words);
  const { storyboard, changed } = anchorMyinCues(story, words, speech);
  assert.equal(storyboard.scenes[0].at, "지한씨는");
  assert.equal(storyboard.scenes[0].lines[0][0].text, "지안 씨는", "shown text never changes");
  assert.equal(storyboard.scenes[0].lines[0][0].cue, "지한씨는");
  assert.equal(storyboard.scenes[1].title[0][0], "세 가지");
  assert.equal(storyboard.scenes[1].cue_b, "있어요", "a cue the transcript holds exactly stays as written");
  assert.equal(storyboard.cta[0].after, "논담을했어요");
  assert.ok(changed.length >= 4 && changed.every((line) => line.includes("받아쓰기")), changed.join(" / "));
  const after = myinCueMisses(storyboard, words);
  assert.ok(before.misses.length + before.fuzzy.length > after.misses.length + after.fuzzy.length, JSON.stringify({ before, after }));
  assert.equal(story.scenes[0].at, "지안 씨는", "the storyboard handed in is not changed in place");
  assert.deepEqual(anchorMyinCues(story, words, "").changed, [], "no script, nothing to anchor");
});

test("matchingBlocks equals difflib's matching blocks, so seqRatio stays the same", () => {
  assert.deepEqual(matchingBlocks("abxcd", "abcd"), [[0, 0, 2], [3, 2, 2]]);
  assert.equal(seqRatio("abxcd", "abcd").toFixed(6), (8 / 9).toFixed(6));
});
