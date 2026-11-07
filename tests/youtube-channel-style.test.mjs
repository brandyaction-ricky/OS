import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { channelFormats, channelMismatch, channelOf, channelStyleInput, formatOfKind, keepsDefault, nextStyles, pinStyle } from "../lib/youtube-process/channel-style.ts";

// 유쓰 요청 5/8 (2026-11-02): per-channel look pinned to a video with its version; the render PC lays it over a copy of the storyboard.
const style = { id: "11111111-1111-4111-8111-111111111111", name: "마이인", channel: "마이인", tone: { base: "myin", key: "#1F7A4D", ink: "#1B2420", page: "#FFFFFF" }, ending: "talk", logo: true };

test("a changed look gets the next version; an unchanged one keeps it", () => {
  const first = nextStyles([], [style], "유쓰", "2026-11-02T01:00:00Z");
  assert.equal(first[0].version, 1);
  assert.equal(nextStyles(first, [style], "유쓰", "x")[0], first[0], "saving the same look keeps version and time");
  const second = nextStyles(first, [{ ...style, logo: false }], "로건", "2026-11-02T02:00:00Z");
  assert.equal(second[0].version, 2); assert.equal(second[0].by, "로건");
  assert.deepEqual(Object.keys(pinStyle(second[0])).sort(), ["channel", "ending", "id", "logo", "name", "tone", "version"]);
});

test("the upload channel is compared with the style's, only when both are named", () => {
  assert.equal(channelMismatch(style, "브랜디액션"), true);
  assert.equal(channelMismatch(style, "마이인"), false);
  assert.equal(channelMismatch({ channel: "" }, "브랜디액션"), false);
  assert.equal(channelMismatch(null, "브랜디액션"), false);
});

test("the render PC draws a styled copy; the storyboard it keeps and sends back stays as written", async () => {
  const worker = await import(`../tools/youtube-media-worker.mjs?style=${Date.now()}`);
  const root = mkdtempSync(path.join(os.tmpdir(), "myin-style-")), videoDir = path.join(root, "voice"), myinDir = path.join(root, "tools");
  mkdirSync(videoDir); mkdirSync(myinDir);
  const story = { scenes: [{ type: "opening" }, { type: "lib_stage_phone" }, { type: "lib_iceberg", theme: "card" }], ending: "outro" };
  writeFileSync(path.join(videoDir, "myin_storyboard.json"), JSON.stringify(story));
  writeFileSync(path.join(myinDir, "톤앤매너.json"), JSON.stringify({ _설명: "x", forest: { base: "myin", key: "#1F7A4D" } }));
  assert.equal(worker.styleStoryboard(videoDir, myinDir, undefined), "myin_storyboard.json", "no style: the storyboard itself");
  assert.equal(worker.styleStoryboard(videoDir, myinDir, style), "myin_storyboard_styled.json");
  let styled = JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard_styled.json"), "utf8"));
  assert.deepEqual(styled.scenes.map((sc) => sc.theme), [undefined, undefined, "card"], "no tone tool in this package: no theme");
  writeFileSync(path.join(myinDir, "myin_tone.py"), "");
  worker.styleStoryboard(videoDir, myinDir, style);
  styled = JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard_styled.json"), "utf8"));
  assert.deepEqual(styled.scenes.map((sc) => sc.theme), [undefined, "os_channel", "card"], "diagram scenes without their own theme");
  assert.equal(styled.ending, "outro", "the storyboard's own ending wins"); assert.equal(styled.logo, "on");
  const tones = JSON.parse(readFileSync(path.join(myinDir, "톤앤매너.json"), "utf8"));
  assert.deepEqual(tones.os_channel, style.tone); assert.ok(tones.forest, "his tones stay");
  assert.deepEqual(JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard.json"), "utf8")), story, "the kept storyboard is untouched");
});

test("the OS pins the style at the voice's start and hands it to every drawing step", async () => {
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /\.\.\.\(picked \? \{ style: pinStyle\(picked\) \} : \{\}\)/);
  assert.equal(run.match(/\.\.\.styleFor\(run\)/g)?.length, 3, "prep, clips and the full video");
  const runKey = run.slice(run.indexOf("const runKey = digestVoiceValue("), run.indexOf("const id = voiceRunId(runKey)"));
  assert.doesNotMatch(runKey, /style/, "a style never makes a new voice");
  const worker = await readFile(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.equal(worker.match(/STORY: styleStoryboard\(videoDir, myinDir, job\.style\)/g)?.length, 3);
});

// 다채널 1단계 (2026-11-07, OS 문서 「다채널 콘텐츠 운영 설계」): the same list is the 채널 카드; the first card is the 기본 채널.
const brandyaction = { id: "11111111-1111-4111-8111-111111111112", name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false, version: 1, updatedAt: "2026-11-04T05:49:19.969Z", by: "대표" };
const moonshot = { id: "22222222-2222-4222-8222-222222222222", name: "마케팅 신설", channel: "", tone: null, ending: "talk", logo: false, purpose: "문샷 무료강의 유입", concept: "반복 업무를 AI에 넘기는 법", topics: "자동화 · 에이전트", formats: ["short", "card", "threads"] };

test("a card saved before channels reads as every format; a new one keeps what it was given", () => {
  assert.deepEqual(channelFormats(brandyaction), ["long", "short", "card", "threads"]);
  assert.deepEqual(channelFormats(moonshot), ["short", "card", "threads"]);
  assert.deepEqual(channelFormats(undefined), ["long", "short", "card", "threads"], "no card at all: nothing is hidden");
  assert.deepEqual(["live", "anim", "short", "card"].map(formatOfKind), ["long", "long", "short", "card"]);
  const parsed = channelStyleInput.parse({ id: brandyaction.id, name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false });
  assert.deepEqual([parsed.purpose, parsed.concept, parsed.topics, parsed.formats], ["", "", "", ["long", "short", "card", "threads"]], "an older client's save keeps every format");
  assert.throws(() => channelStyleInput.parse({ ...moonshot, formats: [] }), /운영 형식/);
});

test("a project without a channel belongs to the 기본 채널; one with a removed channel too", () => {
  const cards = [brandyaction, { ...moonshot, version: 1 }];
  assert.equal(channelOf(cards, undefined), brandyaction);
  assert.equal(channelOf(cards, moonshot.id).name, "마케팅 신설");
  assert.equal(channelOf(cards, "33333333-3333-4333-8333-333333333333"), brandyaction);
  assert.equal(channelOf([], undefined), undefined);
});

test("the 기본 채널 cannot be removed or moved; editing a card's concept is a new version, as a look change is", () => {
  assert.equal(keepsDefault([], [moonshot]), true, "the first save picks the 기본 채널");
  assert.equal(keepsDefault([brandyaction], [brandyaction, moonshot]), true);
  assert.equal(keepsDefault([brandyaction], [moonshot, brandyaction]), false);
  assert.equal(keepsDefault([brandyaction], [moonshot]), false);
  const input = channelStyleInput.parse({ id: brandyaction.id, name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false });
  assert.equal(nextStyles([brandyaction], [input], "x", "y")[0], brandyaction, "saving an older card unchanged keeps its version");
  const next = nextStyles([brandyaction], [{ ...input, concept: "내 강점이 돈 되는 자리" }], "대표", "2026-11-07T01:00:00Z");
  assert.equal(next[0].version, 2); assert.equal(next[0].concept, "내 강점이 돈 되는 자리");
  assert.deepEqual(Object.keys(pinStyle(next[0])).sort(), ["channel", "ending", "id", "logo", "name", "tone", "version"], "a video still pins only the look");
});

test("every way a project is made carries its channel; the save keeps the 기본 채널", async () => {
  const read = (file) => readFile(new URL(`../lib/server/${file}`, import.meta.url), "utf8");
  const [process, cards, short, styles] = await Promise.all([read("youtube-process.ts"), read("youtube-process-cards.ts"), read("youtube-process-short-script.ts"), read("youtube-channel-styles.ts")]);
  assert.match(process, /\.\.\.\(input\.channel \? \{ channel: input\.channel \} : \{\}\)/, "a new project keeps the channel picked");
  assert.match(process, /\.\.\.\(channel \? \{ channel \} : \{\}\) \}/, "an edit keeps or changes it");
  assert.equal(process.match(/await assertChannel\(/g)?.length, 2, "create and edit check the channel exists");
  assert.match(short, /channel: longform\.yp\.topic\.channel \?\? null/, "a 숏폼 from a longform takes the longform's channel");
  assert.match(cards, /channel: project\.yp\.topic\.channel \}/, "a 카드뉴스 from a video takes the video's channel");
  assert.match(cards, /\.\.\.\(channel \? \{ channel \} : \{\}\) \}, now\)/);
  assert.match(styles, /if \(!keepsDefault\(current\.styles, input\.styles\)\)/);
  assert.match(styles, /max\(50\)/, "room for 20+ channels");
});
