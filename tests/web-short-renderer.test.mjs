import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../tools/web-short/", import.meta.url);
const engine = readFileSync(new URL("engine.js", dir), "utf8");
const theme = JSON.parse(readFileSync(new URL("theme.json", dir), "utf8"));

test("every scene in the example storyboards has a template, and subtitles stay one short line", () => {
  for (const f of readdirSync(new URL("examples/", dir))) {
    const story = JSON.parse(readFileSync(new URL(`examples/${f}`, dir), "utf8"));
    for (const s of story.scenes) assert.match(engine, new RegExp(`\\n    ${s.type}\\(s\\) \\{`), `${f}: no template for ${s.type}`);
    for (const [a, b, text] of story.subtitles) {
      assert.ok(b > a && b <= story.duration + 0.01, `${f}: subtitle time ${a}–${b}`);
      assert.ok(text.replace(/\s/g, "").length <= 14, `${f}: subtitle over 14 letters: ${text}`);
    }
  }
});

test("design values the templates read are all in theme.json", () => {
  for (const [, group, key] of engine.matchAll(/\bT\.(\w+)\.(\w+)/g)) assert.ok(theme[group] && key in theme[group], `theme.${group}.${key}`);
  for (const [, key] of engine.matchAll(/\bC\.(\w+)/g)) assert.ok(key in theme.colors, `colors.${key}`);
  for (const [, key] of engine.matchAll(/\bM\.(\w+)/g)) assert.ok(key in theme.motion, `motion.${key}`);
  for (const [, key] of engine.matchAll(/\bG\.(\w+)/g)) assert.ok(key in theme.grid, `grid.${key}`);
});

// ── the OS side: the staff AI's storyboard (phrases) → the renderer's story (seconds) ──
import { checkWebShort, editWebShortTexts, webShortBoard, webShortSceneList, webShortSpoken, webShortTextSlots } from "../lib/web-short-storyboard.ts";

const said = "입사 3년차 마켓터가 회의에서 발표하고 있었어요. 팀장님 얼굴이 굳었어요. 메신저를 열었어요. 지금 진단해 보세요.";
const words = said.split(" ").map((word, i) => [i * 0.5, i * 0.5 + 0.45, word]);
const script = said.replaceAll("마켓터", "마케터");
const good = () => ({
  title: { lines: ["눈치 빠른 사람이", "더 지치는 진짜 이유"], accent: "진짜 이유" },
  scenes: [
    { type: "opening", at: "입사 3년차", photo: "tired.jpg" },
    { type: "react", at: "팀장님 얼굴이", photo: "room.jpg", stimulus: { label: "팀장님 표정", cue: "팀장님", cue_change: "굳었어요" },
      a: { label: "마케터", cue: "얼굴이" }, b: { label: "팀원들", cue: "굳었어요" } },
    { type: "messenger", at: "메신저를", photo: "desk.jpg", name: "팀장님", messages: [{ text: "자료 보내 드립니다.", cue: "메신저를 열었어요", cue_send: "열었어요" }] },
    { type: "endcard", at: "지금 진단해", photo: "phone.jpg", name: "마이인 진단", button: "프로필 링크" },
  ],
  subtitles: ["입사 3년차 마케터가", "회의에서 발표하고 있었어요", "팀장님 얼굴이 굳었어요", "메신저를 열었어요", "지금 진단해 보세요"],
});
const input = { words, script, headCopy: "눈치 빠른 사람이 더 지치는 진짜 이유", durationSeconds: 7, ad: true };

test("a storyboard written in phrases becomes seconds the renderer reads, subtitles timed by the transcript", () => {
  const r = checkWebShort(good(), input);
  assert.deepEqual(r.issues, []);
  const [opening, react, messenger, end] = r.story.scenes;
  assert.deepEqual([opening.from, opening.to, react.from, messenger.from, end.from, end.to], [0, 3, 3, 4.5, 5.5, 7]);
  assert.equal(react.stimulus.changeAt, 4);
  assert.deepEqual([messenger.messages[0].at, messenger.messages[0].atEnd, messenger.messages[0].sendAt], [4.5, 5.45, 5]);
  assert.deepEqual(r.story.subtitles.map(([a]) => a), [0, 1.5, 3, 4.5, 5.5]);   // 「마케터」 in the script is 「마켓터」 in the words
  assert.deepEqual(r.story.title.lines[1], [{ text: "더 지치는" }, { text: "진짜 이유", accent: true }]);
  assert.deepEqual(r.story.cta, []);   // the run reads a 구독 대사 list on every storyboard
});

test("the check sends back what would break the screen or the ad", () => {
  const bad = good();
  bad.scenes[1].a.label = "알아챈 마케터 한 명";        // over 6 letters
  bad.scenes[2].messages[0].cue_typo = "열었어요";        // a slot the template does not have
  bad.scenes.pop();                                       // an ad without its endcard
  bad.subtitles[1] = "회의에서 발표하고 있었습니다 정말로";  // over 14 letters, and not the script
  const issues = checkWebShort(bad, input).issues.join("\n");
  for (const want of ["a.label 「알아챈 마케터 한 명」은 6자", "cue_typo: 이 장면에는 없는 칸", "마지막 장면은 endcard", "14자 이하", "자막을 이으면 대본과 같아야"]) assert.match(issues, new RegExp(want));
  const late = good();
  late.scenes[1].stimulus.cue_change = "지금 진단해";          // said in a later scene
  assert.match(checkWebShort(late, input).issues.join("\n"), /이 장면 밖에서 나오는 말/);
});

test("every template the renderer has is on the card, and only those", () => {
  const listed = [...webShortSceneList().matchAll(/^- (\w+) \(/gm)].map((m) => m[1]);
  const drawn = [...engine.matchAll(/\n {4}(\w+)\(s\) \{/g)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), drawn.sort());
});

test("the render PC hands a web short to its renderer at every stage, and sends YouTube the subtitles as SRT", async () => {
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  for (const stage of ["processMyinPrep", "processMyinRedraw", "processMyinClips", "processMyinFinal"])
    assert.match(worker.slice(worker.indexOf(`export async function ${stage}(`)).split("\nexport ")[0], /job\.renderer === "web"/, stage);
  const { webShortSrt } = await import("../tools/youtube-media-worker.mjs");
  assert.equal(webShortSrt([[0, 1.3, "입사 3년 차 마케터가"], [61.32, 62.5, "한 명 있다고 해보죠"]]),
    "1\n00:00:00,000 --> 00:00:01,300\n입사 3년 차 마케터가\n\n2\n00:01:01,320 --> 00:01:02,500\n한 명 있다고 해보죠\n");
});

test("the subtitle script leaves out the screen hints the voice never reads", () => {
  assert.equal(webShortSpoken(["할 줄 아는 건 많은데.", "[장면] 사람들에게 어떤 도움을 줬는지. [목록] 복잡한 일을 정리해줬는지."]),
    "할 줄 아는 건 많은데. 사람들에게 어떤 도움을 줬는지. 복잡한 일을 정리해줬는지.");
});

test("a person edits a saved scene's text slots in place; limits hold and times stay", () => {
  const scene = { type: "list", at: "복잡한 일을", from: 6.98, to: 10.62, photo: "a.jpg", title: "내가 준 도움",
    items: [{ text: "복잡한 일 정리", cue: "복잡한 일을", at: 6.98, atEnd: 7.94 }, { text: "쉽게 설명", cue: "이해하기 쉽게", at: 8.92, atEnd: 9.9 }] };
  assert.deepEqual(webShortTextSlots(scene).map((s) => `${s.label}=${s.max}`), ["제목=12", "항목 1 · 글자=12", "항목 2 · 글자=12"]);
  const ok = editWebShortTexts(scene, { "items.1.text": "  이해하기 쉽게  설명 " });
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.scene.items[1].text, "이해하기 쉽게 설명");
  assert.equal(ok.scene.items[1].at, 8.92);
  assert.equal(scene.items[1].text, "쉽게 설명");   // the saved scene is not touched
  const bad = editWebShortTexts(scene, { "items.0.text": "복잡한 일을 대신 정리해 준 경험들", "items.0.cue": "x", title: " " });
  assert.equal(bad.issues.length, 3);
  const react = webShortTextSlots({ type: "react", a: { label: "마케터" }, b: { label: "팀원들" }, stimulus: { label: "팀장님 표정" } });
  assert.deepEqual(react.map((s) => s.label), ["자극 · 이름표", "알아챈 사람 · 이름표", "다른 사람들 · 이름표"]);
});

test("a web short also comes in the feed sizes 1:1 and 4:5: the renderer fits the vertical text band, the render PC sends both", () => {
  assert.deepEqual(Object.keys(theme.formats), ["9:16", "1:1", "4:5"]);
  assert.deepEqual(theme.formats["9:16"], { w: theme.frame.w, h: theme.frame.h });
  for (const { w, h } of Object.values(theme.formats)) assert.ok(w % 2 === 0 && h % 2 === 0, "even sizes for yuv420p");
  // the band the feed sizes keep holds the title, the cards and the subtitle line of the vertical design
  assert.ok(theme.band.top <= theme.safe.top && theme.band.bottom >= theme.frame.h - theme.subtitle.bottom);
  const render = readFileSync(new URL("render.py", dir), "utf8");
  assert.match(render, /--format/); assert.match(render, /window\.__FORMAT/);
  assert.match(engine, /window\.__FORMAT/);
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  const final = worker.slice(worker.indexOf("export async function processMyinFinal(")).split("\nexport ")[0];
  assert.match(final, /\["--format", size\]/); assert.match(final, /sizes: true/);
});

test("a storyboard handed in another shape is read as the list it means; none at all says which fields came", () => {
  const scenes = [{ type: "opening", at: "a" }, { type: "photo", at: "b" }];
  assert.deepEqual(webShortBoard({ storyboard: { title: {} }, scenes }).scenes, scenes, "scenes beside the storyboard");
  assert.deepEqual(webShortBoard({ storyboard: { title: {}, scenes: JSON.stringify(scenes) } }).scenes, scenes, "a JSON string");
  assert.deepEqual(webShortBoard({ storyboard: { title: {}, scenes: { 1: scenes[0], 2: scenes[1] } } }).scenes, scenes, "numbered keys");
  assert.deepEqual(webShortBoard({ storyboard: { scenes, subtitles: ["x"] } }).subtitles, ["x"], "a good one is left as it is");
  const { issues } = checkWebShort({ title: { lines: ["가"] }, beats: [] }, { words: [[0, 1, "가"]], script: "가", headCopy: "가", durationSeconds: 1, ad: false });
  assert.match(issues.join(" / "), /지금 storyboard 칸: title, beats/);
});

