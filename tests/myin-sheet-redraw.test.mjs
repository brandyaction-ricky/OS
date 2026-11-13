import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sheetCells } from "../lib/myin-scene-notes.ts";

// 점검 시트 (직원 요청 2026-11-13): sheets drawn with the engine on the video's clock, numbered by the storyboard, and after a 장면 수정안 only
// the scenes it changed drawn again.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const python = ["python3", "python"].find((name) => spawnSync(name, ["-c", "import PIL"]).status === 0);
const script = path.resolve("tools/myin_redraw.py");

// A stand-in engine: load() reads STORY, frame() paints the scene on screen at the video's clock (100 s ahead of the voice).
const FAKE_ENGINE = `import json, os
from PIL import Image
class M:
    W, H = 1920, 1080
    @staticmethod
    def out_time(t): return t + 100
    @staticmethod
    def frame(scenes, T):
        sc = next(s for s in scenes if s["t0"] <= T - 100 < s["t1"])
        return Image.new("RGB", (1920, 1080), tuple(sc["rgb"]))
def load(job):
    st = json.load(open(os.environ["STORY"]))
    return ".", [dict(s) for s in st["scenes"]], st
`;
const scene = (type, at, t0, rgb) => ({ type, at, t0, t1: t0 + 10, rgb });
const OLD = [scene("opening", "a", 0, [200, 0, 0]), scene("lib_x", "b", 10, [0, 200, 0]), scene("photo", "c", 20, [0, 0, 200])];

function run(newScenes, old = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "redraw-"));
  writeFileSync(path.join(dir, "render_myin.py"), FAKE_ENGINE);
  writeFileSync(path.join(dir, "old.json"), JSON.stringify({ scenes: OLD }));
  writeFileSync(path.join(dir, "new.json"), JSON.stringify({ scenes: newScenes }));
  // The old sheet: each cell one plain grey, so a kept cell is told apart from a drawn one.
  const sheet = `from PIL import Image
im = Image.new("RGB", (1920, 1440), (128, 128, 128))
for j in range(3): im.paste(Image.new("RGB", (640, 360), (10 + j, 10 + j, 10 + j)), ((j % 3) * 640, 0))
import os; os.makedirs("old", exist_ok=True); im.save("old/preview_01.png")`;
  assert.equal(spawnSync(python, ["-c", sheet], { cwd: dir }).status, 0);
  const out = spawnSync(python, [script, "job", old ? "old.json" : "-", old ? "old" : "-", "out"], { cwd: dir, encoding: "utf8", env: { ...process.env, STORY: "new.json" } });
  assert.equal(out.status, 0, out.stderr);
  const pixel = spawnSync(python, ["-c", `from PIL import Image
im = Image.open("out/preview_01.png").convert("RGB")
print([im.getpixel((x * 640 + 300, 100)) for x in range(3)])`], { cwd: dir, encoding: "utf8" }).stdout.trim();
  return { report: JSON.parse(readFileSync(path.join(dir, "out", "redraw.json"), "utf8")), pixels: pixel };
}

test("only a scene resolved differently is drawn; the others keep their cells from the old sheets", { skip: !python && "needs Pillow" }, () => {
  const { report, pixels } = run([OLD[0], { ...OLD[1], rgb: [250, 250, 0] }, OLD[2]]);
  assert.deepEqual(report.drawn, [2]);
  assert.deepEqual(report.cells, [1, 2, 3]);
  assert.equal(pixels, "[(10, 10, 10), (250, 250, 0), (12, 12, 12)]");
});

test("a dropped scene moves the cells after it; the scene that runs on is drawn again, on the video's clock", { skip: !python && "needs Pillow" }, () => {
  const { report, pixels } = run([OLD[0], { ...OLD[1], t1: 30 }]);
  assert.deepEqual(report.drawn, [2]);
  assert.equal(pixels, "[(10, 10, 10), (0, 200, 0), (128, 128, 128)]");
});

test("without old sheets every cell is drawn and numbered by the storyboard", { skip: !python && "needs Pillow" }, () => {
  const { report, pixels } = run(OLD, false);
  assert.deepEqual(report.drawn, [1, 2, 3]);
  assert.equal(pixels, "[(200, 0, 0), (0, 200, 0), (0, 0, 200)]");
});

test("cells: the drawing's storyboard numbers, else one per scene by place", () => {
  assert.deepEqual(sheetCells({ cells: [1, 1, 1, 2, 3], scenes: [{}, {}, {}], urls: ["a"] }), [1, 1, 1, 2, 3]);
  assert.deepEqual(sheetCells({ cells: null, scenes: [{}, {}, {}], urls: ["a"] }), [1, 2, 3]);
  assert.equal(sheetCells({ cells: null, scenes: [], urls: ["a", "b"] }).length, 24);
});

test("a 수정안 applied queues the drawing; it runs on the video's own computer before any preparation, and the sheets then show that storyboard", () => {
  const run = read("lib/server/myin-run.ts");
  const edit = run.slice(run.indexOf("export async function saveMyinSceneEdit"), run.indexOf("async function putStoryboard"));
  assert.match(edit, /redraw: \{ state: "pending" as const/);
  assert.match(run, /const at = run\.prepared\?\.storyAt \|\| run\.prepared\?\.used\?\.storyboard/);
  const done = run.slice(run.indexOf("export async function completeMyinRedraw"), run.indexOf("export async function failMyinRedraw"));
  assert.match(done, /storyboardPath: redraw\.path, storyAt: redraw\.storyboardAt/);
  assert.match(done, /run\.storyboard\?\.at !== redraw\.storyboardAt\) next\.redraw = \{ state: "pending"/, "a 수정안 applied while drawing draws again");
  const claim = run.slice(run.indexOf("export async function claimMyinRedraw"), run.indexOf("const redrawLease"));
  assert.match(claim, /placeFilter\(owner\)\(run\)/);
  assert.match(claim, /pinnedElsewhere\(run, pc\)/);
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /processMyinRedraw\(\)\.then\(\(done\) => done \|\| processMyinPrep\(\)\)/, "a member's own computer");
  assert.match(worker, /processMyinCta\(\)\)\.then\(\(rendered\) => rendered \|\| processMyinRedraw\(\)\)\.then\(\(rendered\) => rendered \|\| processMyinPrep\(\)\)/, "the render PC");
  // The preparation draws its sheets the same way (his preview() only where ours fails) and sends their cell numbers.
  const prep = worker.slice(worker.indexOf("export async function processMyinPrep"), worker.indexOf("async function fetchPhotos"));
  assert.match(prep, /await drawSheets\(myinDir, videoDir, previewEnv, job\.sheetUploadUrls\.length\)/);
  assert.match(prep, /sheets: sheets\.length, cells,/);
});
