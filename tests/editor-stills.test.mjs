import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DRAFT_VERSION, editorScreenState, firstSave } from "../lib/myin-edit.ts";

// 장면 그림 v0 (편집기 3차 요청, 2026-11-09): a longform's ③ is each scene's finished picture on the editor screen; 「완성」 makes the
// first moving final with ④ · ⑤. Hand edits made before it are applied by the editing computer first.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const section = (text, from, to) => { const a = text.indexOf(from); assert.ok(a >= 0, from); const b = text.indexOf(to, a + from.length); return text.slice(a, b < 0 ? undefined : b); };
const python = ["python3", "python"].find((name) => spawnSync(name, ["-c", "import PIL, numpy"]).status === 0);
const plain = ["python3", "python"].find((name) => spawnSync(name, ["-c", "pass"]).status === 0);

test("the first 완성: nothing waiting starts ④ · ⑤, edits wait for the editing computer, and a second press changes nothing", () => {
  assert.equal(firstSave({ ready: true, making: false, open: 0, editor: false }), "finish");
  assert.equal(firstSave({ ready: true, making: false, open: 0, editor: true }), "finish", "an open editor with nothing to apply is not waited for");
  assert.equal(firstSave({ ready: true, making: false, open: 2, editor: true }), "editor");
  assert.equal(firstSave({ ready: true, making: false, open: 2, editor: false }), "need_editor", "edits are never dropped by a 완성 nobody can apply them for");
  assert.equal(firstSave({ ready: false, making: true, open: 0, editor: false }), "making");
  assert.equal(firstSave({ ready: false, making: false, open: 0, editor: false }), "not_ready");
  assert.equal(DRAFT_VERSION, "v0");
});

test("while v1 is made from the pictures the screen says so, and v0 is the work version until then", () => {
  const v0 = { name: "v0", at: "2026-11-09T10:00:00.000Z", files: 90, bytes: 1, note: "장면 그림" };
  const s = editorScreenState({ versions: [v0], finals: [], orders: [], save: { at: "2026-11-09T10:05:00.000Z" }, base: null, lock: null, now: 0 });
  assert.equal(s.saves.pending.label, "v1");
  assert.equal(s.draft, "v0");
  const edit = read("lib/server/myin-edit.ts");
  assert.match(section(edit, "export async function screenView", "// ── 장면 그림 v0"), /save: meta\?\.save \?\? \(making \? \{ at: making \} : null\)/);
});

test("완성 before the first final goes through the OS (④ · ⑤ where ③ was made); after it, through the editing computer as before", () => {
  const edit = read("lib/server/myin-edit.ts");
  const save = section(edit, "export async function requestSave", "/** The editing computer finished");
  assert.ok(save.indexOf("if (!finals.length)") < save.indexOf("if (!lock || !meta) throw"), "no lock is needed for the first 완성");
  assert.match(save, /if \(meta\?\.save\) return \{ ok: true, label, waiting: open \};\n    const draft/, "a second press never starts ④ without the edits that wait");
  assert.match(save, /if \(draft\.stopped\) throw new ApiError\(409, "EDIT_FIRST_STOPPED"/, "a stop at ④ · ⑤ is told, not shown as 완성 중");
  assert.match(save, /if \(actor\.type !== "user"\) throw new ApiError\(403, "EDIT_PERSON_ONLY"/, "paid steps start from a person only");
  assert.match(save, /if \(step === "finish"\) \{ await finishMyinDraft\(actor, project\.id\);/);
  const run = read("lib/server/myin-run.ts");
  const finish = section(run, "export async function finishMyinDraft", "/**");
  assert.match(finish, /resumeFinal: true/, "④ goes on to ⑤ without a stop");
  assert.match(finish, /if \(run\.local\) next\.localFinish = \{ \.\.\.run\.local, at \}; else delete next\.localFinish;/, "the computer that made ③ (its folder holds the pictures, voice and subtitles)");
  assert.match(finish, /return \{ making: false as const, run: presentMyinRun\(await beginPrep\(service, record, next, actor\.id\)\) \};/, "one save: never half done");
  assert.ok(finish.indexOf("photosInUse(next, edited.storyboard") < finish.indexOf("putStoryboard"), "a photo ④ cannot fetch stops it before anything is saved");
  assert.match(finish, /next\.ours = \{ \.\.\.next\.ours, \[image\.file\]: /, "pictures put in on the editor reach ④ as our images");
  const draft = section(edit, "export async function draftFinish", "\n}\n");
  assert.match(draft, /checkMyinStoryboard\(storyboard, myin\.words/, "the edited storyboard is checked like any");
  assert.match(draft, /if \(\(await myinFinalNumbers\(service, project\.id\)\)\.length\) throw/);
  assert.match(draft, /if \(!meta\.save\) throw new ApiError\(409, "EDIT_NO_SAVE"/, "only after a person pressed 완성");
  assert.match(read("lib/server/myin-run.ts"), /if \(run\.stills\) next\.resumeFinal = true;/, "the panel's 완성 button does the same");
});

test("a computer whose engine can draw them makes the scene pictures instead of clips; an older one still cuts clips", () => {
  const run = read("lib/server/myin-run.ts");
  const claim = section(run, "export async function claimMyinClips", "const ASSET_VIDEO_BUCKET");
  assert.match(claim, /if \(stills && !run\.layout && !run\.final && !run\.finals\?\.length\) return \{ runId: record\.id, lease: lease\.token, stills: true as const/,
    "a video that already has a final goes on through finals, as before");
  const complete = section(run, "export async function completeMyinClips", "/** Logan's OK on the clips");
  assert.match(complete, /registerDraftVersion\(service, run\.sourceId, record\.id\)/);
  assert.match(complete, /if \(staleResult\(run\)\)/, "pictures from materials that changed meanwhile are not taken");
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /const stills = stillsReady\(\) \? \{ stills: true \} : \{\};/);
  assert.match(worker, /existsSync\(path\.join\(pkg, "tools", "editor", "engine_common\.py"\)\)/, "his editor functions come with the engine, not with git");
  assert.match(section(worker, "async function drawStills", "/** v13 stage 4a"), /action: "myin_stills_upload"[\s\S]*action: "myin_clips_complete", \.\.\.lease, stills: \{ files: files\.length \}/);
  for (const route of ["app/api/v1/content/youtube-automation/media/route.ts", "app/api/v1/content/youtube-automation/local-render/route.ts"])
    assert.match(read(route), /input\.action === "myin_stills_upload" \? await myinStillsUpload\(input\)/, route);
  assert.match(read("lib/server/myin-run.ts"), /if \(!run\.layout\) await import\("\.\/myin-edit"\)\.then\(\(edit\) => edit\.dropDraftVersion/, "a final replaces the run's pictures");
  assert.match(section(read("lib/server/myin-edit.ts"), "export async function dropDraftVersion", "export const draftFinishSchema"), /screen\?\.lockId !== runId\) return;/, "only this run's v0, never an editing computer's versions");
});

test("the worker lists v0's files as the editor takes them", async () => {
  const worker = await import(`../tools/youtube-media-worker.mjs?stills=${Date.now()}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "myin-v0-"));
  for (const name of ["version.json", "video.mp4", "thumb_00.jpg", "voice.m4a", "wave.json", "subs.srt", ".DS_Store", "still_00.jpg.tmp"]) writeFileSync(path.join(dir, name), "x");
  writeFileSync(path.join(dir, "empty.json"), "");
  assert.deepEqual(worker.stillFileList(dir).map((f) => f.name), ["subs.srt", "thumb_00.jpg", "version.json", "video.mp4", "voice.m4a", "wave.json"]);
  const pkg = mkdtempSync(path.join(os.tmpdir(), "myin-pkg-"));
  assert.equal(worker.stillsReady(pkg), false, "an engine without the editor functions keeps cutting clips");
  mkdirSync(path.join(pkg, "tools", "editor"), { recursive: true });
  writeFileSync(path.join(pkg, "tools", "editor", "engine_common.py"), "");
  assert.equal(worker.stillsReady(pkg), true);
});

test("a scene's picture is its last moment before the next scene, and the subtitles move with the holds", { skip: !plain && "needs python3" }, () => {
  const code = `
import sys; sys.path.insert(0, "tools")
import myin_v0 as V
print(V.settled_at({"t0": 10.0, "t1": 20.0, "lines": [[["첫 줄", 10.0]], [["둘째 줄", 18.4]]]}))
print(V.settled_at({"t0": 10.0, "t1": 20.0, "points": [{"h": "a"}, {"h": "b"}]}))
print(V.settled_at({"t0": 10.0, "t1": 10.12}))
ass = "[Events]\\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\\\an2}첫 줄\\\\N둘째\\nDialogue: 0,0:01:00.00,0:01:01.00,Default,,0,0,0,,끝"
print(V.srt_from_ass(ass, lambda t: t + 4.0))`;
  const run = spawnSync(plain, ["-I", "-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const [a, b, c, ...srt] = run.stdout.trim().split("\n");
  assert.equal(Number(a), 19.75, "a line that comes in late (a [text, time] pair) is in the picture");
  assert.equal(Number(b), 19.75, "rows on the scene's own clock are all in");
  assert.equal(Number(c), 10, "a flash shorter than the margin: its start");
  assert.deepEqual(srt, ["1", "00:00:05,000 --> 00:00:06,500", "첫 줄 둘째", "", "2", "00:01:04,000 --> 00:01:05,000", "끝"]);
});

test("a moment the engine cannot draw is listed as 그리기 오류 and sends the storyboard back like a blank scene", { skip: !python && "needs Pillow and numpy" }, () => {
  const code = `
import sys; sys.path.insert(0, "tools")
from PIL import Image
import myin_frame_check as F
class M:
    @staticmethod
    def out_time(t): return t
    @staticmethod
    def frame(scenes, T):
        if 12 < T < 14: raise KeyError("arrow")
        return Image.new("RGB", (1920, 1080), (40, 90, 200)) if T >= 10 else Image.effect_noise((1920, 1080), 60).convert("RGB")
errors = []
scenes = [{"type": "statement", "t0": 0, "t1": 10}, {"type": "lib_x", "t0": 10, "t1": 20}]
F.flat_moments(scenes, M, 5, errors)
print(sorted({e["scene"] for e in errors}), errors[0]["error"])`;
  const run = spawnSync(python, ["-I", "-c", code], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[2] KeyError: 'arrow'");
  assert.match(read("tools/myin_frame_check.py"), /그리기 오류/);
});

test("the first 완성 from the editor screen asks for the paid steps first; a picture the engine cannot draw does not stop ③", () => {
  const screen = read("components/editor-screen.tsx");
  assert.match(screen, /if \(beforeFinal\.current && !await cost\.confirm\(/);
  assert.match(screen, /throw new Error\("완성을 취소했어요\."\);/);
  const v0 = read("tools/myin_v0.py");
  assert.match(v0, /for t in \(settled_at\(s\), s\["t0"\] \+ 0\.6\):/);
  assert.match(v0, /못 그린 장면/);
});

test("GPT's screen check can be turned off; the free blank and error checks always run", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /if \(bundle\.sheets && !run\.screenCheckOff\) await import\("\.\/myin-screen-check"\)/);
  assert.match(run, /if \(screenCheck \?\? run\.settings\?\.screenCheck \?\? true\) delete next\.screenCheckOff; else next\.screenCheckOff = true;/);
  // 제작 설정: the switch is in the card chosen once at the start; the confirm sends neither place nor screenCheck.
  assert.match(read("components/myin-make-settings.tsx"), /checked=\{value\.screenCheck\}/);
  assert.match(read("components/myin-v13-panel.tsx"), /action: "review", runId: run\.id, decision: "confirmed", note \}/);
  assert.match(read("components/myin-screen-check.tsx"), /auto && !current && Date\.parse\(preparedAt\)/, "an off check is not shown as running");
});

test("④ on the computer that made ③ does not fetch the same photos again", () => {
  const prep = section(read("tools/youtube-media-worker.mjs"), "export async function processMyinPrep", "async function blankScenes");
  assert.match(prep, /if \(fetched\[`\$\{asset\.kind\}\/\$\{asset\.file\}`\] === from && existsSync\(file\)\) continue;/);
  assert.ok(prep.indexOf("fetched[`${asset.kind}/${asset.file}`] = from") > prep.indexOf("await fetchTo(asset.url, file)"), "a 사진 자리 (fetch failed) is never marked as fetched");
});
