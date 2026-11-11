import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// 렌더 전 관문 (로건 개발 문서 v3 7.2-3): blank scenes found before any video is drawn, and the storyboard sent back by itself at ③.
const python = ["python3", "python"].find((name) => spawnSync(name, ["-c", "import PIL, numpy"]).status === 0);

test("a scene flat above the subtitles at most of its moments is blank; one flat moment or the end screen is not", { skip: !python && "needs Pillow and numpy" }, () => {
  const code = `
import sys; sys.path.insert(0, "tools")
from PIL import Image, ImageDraw
import myin_frame_check as F
class M:
    @staticmethod
    def out_time(t): return t
    @staticmethod
    def frame(scenes, T):
        im = Image.new("RGB", (1920, 1080), (255, 255, 255)); d = ImageDraw.Draw(im)
        d.rectangle((0, 900, 1920, 1000), fill=(30, 30, 30))
        if not (10 <= T < 20) and not (21 < T < 22): d.rectangle((300, 300, 1600, 600), fill=(20, 60, 200))
        return im
scenes = [{"type": "statement", "t0": 0, "t1": 10}, {"type": "lib_x", "t0": 10, "t1": 20}, {"type": "hero", "t0": 20, "t1": 30}, {"type": "endscreen", "t0": 30, "t1": 40}]
print(sorted({f["scene"] for f in F.flat_moments(scenes, M, 5)}))`;
  const run = spawnSync(python, ["-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[2]");
});

test("the render PC adds blank scenes to the preview's misses, and never stops a run by failing itself", () => {
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /\.\.\.log\.split\("\\n"\)\.filter\(\(line\) => line\.includes\("못 찾음"\)\), \.\.\.await blankScenes\(myinDir, videoDir, previewEnv\)\]/);
  const blank = worker.slice(worker.indexOf("async function blankScenes"), worker.indexOf("export async function processMyinCta"));
  assert.match(blank, /if \(!existsSync\(script\)\) return \[\];/);
  assert.match(blank, /result\.ok \? JSON\.parse\(readFileSync\(out, "utf8"\)\)\.lines \?\? \[\] : \[\]/);
  assert.match(blank, /catch \{ return \[\]; \}/);
  const check = readFileSync(new URL("../tools/myin_frame_check.py", import.meta.url), "utf8");
  assert.match(check, /import render_myin as R/, "the engine's own load and frame()");
  assert.match(check, /빈 화면/);
});

test("at ③ a phrase the engine cannot place or a blank scene sends the storyboard back with the list; ④ still stops for a person", () => {
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const prep = run.slice(run.indexOf("export async function completeMyinPrep"), run.indexOf("export async function failMyinPrep"));
  assert.match(prep, /const gate = draft \? bundle\.misses\.filter\(\(line\) => \/못 찾음\|빈 화면\|그리기 오류\|늦게 바뀜\|초 미만 장면\/\.test\(line\)\) : \[\];/);
  assert.match(prep, /review: \{ decision: "revise",.*name: MYIN_GATE_NAME/s);
  assert.match(prep, /await save\(service, record, "backlog", "words_ready", back\)/);
  assert.ok(prep.indexOf("const gate") < prep.indexOf("scheduleScreenCheck"), "no GPT screen check for a storyboard going back");
  const jobs = readFileSync(new URL("../lib/server/youtube-ai-jobs.ts", import.meta.url), "utf8");
  assert.match(jobs, /note = myin\.run\.review\?\.decision === "revise" \? myin\.run\.review\.note : ""/, "the next staff-AI pass gets the list");
  const panel = readFileSync(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /run\.review\.name === "렌더 전 관문" \? "렌더 전 관문 · 자동 수정 요청"/);
});
