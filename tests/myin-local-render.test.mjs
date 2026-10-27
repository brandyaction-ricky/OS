import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { draftFilter, localBlocker, localDraft } from "../lib/myin-local.ts";

// 내 컴퓨터로 시안 (owner decision 2026-10-27): ③ drafts sent to a member's own Mac are only theirs; the render PC keeps the rest.
test("the render PC skips drafts sent to a member's Mac, and a Mac takes only its owner's", () => {
  const mine = { local: { by: "u1" } }, theirs = { local: { by: "u2" } }, pc = {}, confirmed = { local: { by: "u1" }, clipsReview: { by: "x" } };
  assert.equal(localDraft(mine), true);
  assert.equal(localDraft(confirmed), false, "after the drafts are confirmed (④ and the full video) the run is the render PC's again");
  const renderPc = draftFilter(), myMac = draftFilter("u1");
  assert.deepEqual([mine, theirs, pc, confirmed].map(renderPc), [false, false, true, true]);
  assert.deepEqual([mine, theirs, pc, confirmed].map(myMac), [true, false, false, false]);
});

test("내 컴퓨터 can take drafts only while on and on the render PC's engine", () => {
  const on = { state: "online", ageSeconds: 20, engine: "same", job: null };
  assert.equal(localBlocker(on), null);
  assert.match(localBlocker(null), /연결/);
  assert.match(localBlocker({ ...on, state: "offline" }), /꺼져/);
  assert.match(localBlocker({ ...on, engine: "different" }), /엔진/);
  assert.match(localBlocker({ ...on, engine: "unknown" }), /확인/);
});

const fakePackage = (code) => {
  const pkg = mkdtempSync(path.join(os.tmpdir(), "myin-engine-"));
  mkdirSync(path.join(pkg, "tools", "myin_pipeline", "__pycache__"), { recursive: true });
  mkdirSync(path.join(pkg, "assets", "fonts"), { recursive: true });
  writeFileSync(path.join(pkg, "tools", "myin_pipeline", "render_myin.py"), code);
  writeFileSync(path.join(pkg, "tools", "myin_pipeline", "__pycache__", "render_myin.cpython-312.pyc"), String(Math.random()));
  writeFileSync(path.join(pkg, "assets", "fonts", "font.ttf"), "0123456789");
  return pkg;
};
const engineOf = async (pkg) => {
  Object.assign(process.env, { MYIN_PKG: pkg, MYIN_PYTHON: "python3", MYIN_LIBRARY: path.join(pkg, "no-library") });
  delete process.env.MYIN_DIAGRAM_DIR; delete process.env.MYIN_FONT_DIR;
  const worker = await import(`../tools/youtube-media-worker.mjs?engine=${Math.random()}`);
  return worker.engine();
};

test("the engine fingerprint follows the engine's content, not where it is installed or its caches", { skip: spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const a = await engineOf(fakePackage("print('v1')\n")), b = await engineOf(fakePackage("print('v1')\n")), c = await engineOf(fakePackage("print('v2')\n"));
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(a, b, "the same engine in another folder (a staff Mac) gives the same fingerprint; caches are ignored");
  assert.notEqual(a, c, "a changed engine file changes the fingerprint");
});

// A staff Mac never had stage 1's work folder: it is rebuilt from the OS — his voice post-processing again on the same Fish
// paragraphs, and the frozen transcription and subtitles as they are (never transcribed twice).
test("a staff Mac rebuilds the run's work folder from the OS once", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const pkg = fakePackage("print('v1')\n"), work = mkdtempSync(path.join(os.tmpdir(), "myin-work-"));
  mkdirSync(path.join(pkg, "tools", "mindmap_pipeline"), { recursive: true });
  // His stage_voice writes speech.txt from the script; this stand-in copies the script's lines and makes voice.wav.
  writeFileSync(path.join(pkg, "tools", "mindmap_pipeline", "stage_voice.py"), [
    "import sys, shutil", "lines = [l for l in open(sys.argv[1], encoding='utf-8').read().splitlines() if l.strip()]",
    "open('../../voice/' + sys.argv[2] + '/speech.txt', 'w', encoding='utf-8').write('\\n'.join(lines) + '\\n')",
    "shutil.copy('../../voice/' + sys.argv[2] + '/p00.wav', '../../voice/' + sys.argv[2] + '/voice.wav')"].join("\n"));
  const wav = path.join(work, "tone.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-ar", "44100", wav]);
  const words = { words: [[0, 0.2, "안녕"]], subtitlesAss: "[Script Info]\nDialogue: 0,0:00:00.00,0:00:00.20,Default,,0,0,0,,안녕\n", subtitleQc: "# QC\n", speech: "안녕\n", durationSeconds: 0.2 };
  const server = createServer((request, response) => {
    if (request.url === "/p00") { response.writeHead(200, { "content-type": "audio/wav" }); response.end(readFileSync(wav)); }
    else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(words)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    Object.assign(process.env, { MYIN_PKG: pkg, MYIN_PYTHON: "python3", MYIN_WORK: work });
    const worker = await import(`../tools/youtube-media-worker.mjs?rebuild=${Math.random()}`);
    const seed = { scriptMarkdown: "안녕\n", paragraphs: [{ index: 0, text: "안녕", url: `${base}/p00` }], wordsUrl: `${base}/words` };
    await worker.myinRebuild("run-1", seed);
    const videoDir = path.join(work, "run-1", "voice", "os_myin");
    assert.deepEqual(JSON.parse(readFileSync(path.join(videoDir, "words.json"), "utf8")), words.words);
    assert.equal(readFileSync(path.join(videoDir, "subs_myin.ass"), "utf8"), words.subtitlesAss);
    assert.ok(existsSync(path.join(work, "run-1", "voice", "os_voice", "voice.wav")), "his voice post-processing ran on the OS paragraphs");
    assert.ok(existsSync(path.join(work, "run-1", "tools", "myin_pipeline", "render_myin.py")), "the run has its own copy of the engine");
    // A second claim of the same run (its clips after its preparation) reuses the folder.
    writeFileSync(path.join(videoDir, "words.json"), "[]");
    await worker.myinRebuild("run-1", { ...seed, wordsUrl: `${base}/never` });
    assert.equal(readFileSync(path.join(videoDir, "words.json"), "utf8"), "[]");
    await assert.rejects(worker.myinRebuild("run-2", { ...seed, paragraphs: [{ index: 0, text: "다른 문장", url: `${base}/p00` }] }), { code: "MYIN_PARAGRAPHS_MISMATCH" });
  } finally { server.close(); }
});
