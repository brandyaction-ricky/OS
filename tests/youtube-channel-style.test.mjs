import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { channelMismatch, nextStyles, pinStyle } from "../lib/youtube-process/channel-style.ts";

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
