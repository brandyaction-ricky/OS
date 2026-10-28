import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const tone = "톤앤매너.json";
const fakePackage = (code, form = "NFC") => {
  const pkg = mkdtempSync(path.join(os.tmpdir(), "myin-engine-"));
  mkdirSync(path.join(pkg, "tools", "myin_pipeline", "__pycache__"), { recursive: true });
  mkdirSync(path.join(pkg, "assets", "fonts"), { recursive: true });
  writeFileSync(path.join(pkg, "tools", "myin_pipeline", "render_myin.py"), code);
  writeFileSync(path.join(pkg, "tools", "myin_pipeline", "__pycache__", "render_myin.cpython-312.pyc"), String(Math.random()));
  writeFileSync(path.join(pkg, "assets", "fonts", "font.ttf"), "0123456789");
  writeFileSync(path.join(pkg, "tools", "myin_pipeline", tone.normalize(form)), "{}");
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
  assert.equal(await engineOf(fakePackage("print('v1')\n", "NFD")), a, "a Korean name stored decomposed (a Mac's tar) is the same engine");
});

// A staff Mac never had stage 1's work folder: it is rebuilt from the OS — the render PC's processed voice.wav byte for byte
// (his sentence gaps are a seeded random draw, so recomputing could shift every cue) and the frozen transcription and subtitles.
test("a staff Mac rebuilds the run's work folder from the render PC's own voice and words", async () => {
  const pkg = fakePackage("print('v1')\n"), work = mkdtempSync(path.join(os.tmpdir(), "myin-work-"));
  const voice = Buffer.from(Array.from({ length: 25 }, (_, i) => i)), half = [voice.subarray(0, 13), voice.subarray(13)];
  const words = { words: [[0, 0.2, "안녕"]], subtitlesAss: "[Script Info]\nDialogue: 0,0:00:00.00,0:00:00.20,Default,,0,0,0,,안녕\n", subtitleQc: "# QC\n", speech: "안녕\n", durationSeconds: 0.2 };
  const server = createServer((request, response) => {
    const part = request.url.match(/^\/part(\d)$/);
    if (part) { response.writeHead(200, { "content-type": "audio/wav" }); response.end(half[Number(part[1])]); }
    else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(words)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    Object.assign(process.env, { MYIN_PKG: pkg, MYIN_PYTHON: "python3", MYIN_WORK: work });
    const worker = await import(`../tools/youtube-media-worker.mjs?rebuild=${Math.random()}`);
    const sha256 = (await import("node:crypto")).createHash("sha256").update(voice).digest("hex");
    const seed = { voice: { urls: [`${base}/part0`, `${base}/part1`], bytes: voice.length, sha256 }, wordsUrl: `${base}/words` };
    await worker.myinRebuild("run-1", seed);
    const voiceDir = path.join(work, "run-1", "voice", "os_voice"), videoDir = path.join(work, "run-1", "voice", "os_myin");
    assert.deepEqual(readFileSync(path.join(voiceDir, "voice.wav")), voice, "the parts join into the render PC's exact voice.wav");
    assert.deepEqual(JSON.parse(readFileSync(path.join(videoDir, "words.json"), "utf8")), words.words);
    assert.equal(readFileSync(path.join(videoDir, "subs_myin.ass"), "utf8"), words.subtitlesAss);
    assert.ok(existsSync(path.join(work, "run-1", "tools", "myin_pipeline", "render_myin.py")), "the run has its own copy of the engine");
    // The clips after the preparation reuse the folder.
    writeFileSync(path.join(videoDir, "words.json"), "[]");
    await worker.myinRebuild("run-1", { ...seed, wordsUrl: `${base}/never` });
    assert.equal(readFileSync(path.join(videoDir, "words.json"), "utf8"), "[]");
    await assert.rejects(worker.myinRebuild("run-2", { ...seed, voice: { ...seed.voice, sha256: "0".repeat(64) } }), { code: "MYIN_VOICE_MISMATCH" });
    assert.equal(existsSync(path.join(work, "run-2", "voice", "os_myin", "words.json")), false, "a voice that does not match is never used");
  } finally { server.close(); }
});

test("the render PC's voice.wav leaves stage 1 in parts the voice bucket accepts", { skip: spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const received = [];
  const server = createServer((request, response) => { const chunks = []; request.on("data", (c) => chunks.push(c)); request.on("end", () => { received.push([request.url, request.headers["content-type"], Buffer.concat(chunks)]); response.end("{}"); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const worker = await import(`../tools/youtube-media-worker.mjs?parts=${Math.random()}`);
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "myin-voice-")), "voice.wav");
    writeFileSync(file, Buffer.alloc(25_000_001, 7));
    const info = await worker.uploadVoiceParts(file, Array.from({ length: 18 }, (_, i) => `${base}/u${i}`));
    assert.deepEqual([info.parts, info.bytes], [3, 25_000_001]);
    assert.deepEqual(received.map(([url, type, body]) => [url, type, body.length]), [["/u0", "audio/wav", 10_000_000], ["/u1", "audio/wav", 10_000_000], ["/u2", "audio/wav", 5_000_001]]);
    assert.equal(await worker.uploadVoiceParts(file, [`${base}/only`]), null, "a voice longer than the parts allow stays on the render PC");
  } finally { server.close(); }
});

// The staff PC runner (public/myin-local): the render PC's bundle, checked part by part, becomes this PC's engine.
test("a staff PC installs the render PC's engine bundle only when every part matches", { skip: spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const { createHash } = await import("node:crypto");
  const src = mkdtempSync(path.join(os.tmpdir(), "myin-bundle-"));
  mkdirSync(path.join(src, "engine", "pkg", "tools", "myin_pipeline"), { recursive: true }); mkdirSync(path.join(src, "tools"), { recursive: true });
  writeFileSync(path.join(src, "engine", "pkg", "tools", "myin_pipeline", "render_myin.py"), "print(1)\n");
  writeFileSync(path.join(src, "engine", "pkg", "tools", "myin_pipeline", tone.normalize("NFD")), "{}");
  writeFileSync(path.join(src, "tools", "youtube-media-worker.mjs"), "process.exit(0)\n");
  writeFileSync(path.join(src, "requirements.lock"), ""); writeFileSync(path.join(src, "python-version"), "3.9");
  const fingerprint = "a".repeat(32); writeFileSync(path.join(src, "FINGERPRINT"), `${fingerprint}\n`);
  const tarball = path.join(mkdtempSync(path.join(os.tmpdir(), "myin-tar-")), "bundle.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", tarball, "-C", src, "."]).status, 0);
  const bytes = readFileSync(tarball), parts = [bytes.subarray(0, 100), bytes.subarray(100)];
  const server = createServer((request, response) => { response.end(parts[Number(request.url.slice(1))]); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    process.env.MYIN_LOCAL_PYTHON = "python3";
    const runner = await import(`../public/myin-local/myin-local.mjs?install=${Math.random()}`);
    const home = mkdtempSync(path.join(os.tmpdir(), "myin-home-"));
    const info = { fingerprint, python: "3.9", parts: parts.map((part, n) => ({ url: `${base}/${n}`, bytes: part.length, sha256: createHash("sha256").update(part).digest("hex") })) };
    await assert.rejects(runner.installEngine({ ...info, parts: [{ ...info.parts[0], sha256: "0".repeat(64) }, info.parts[1]] }, home), /손상/);
    assert.equal(existsSync(path.join(home, `engine-${fingerprint}`)), false, "a damaged bundle is never installed");
    const engine = await runner.installEngine(info, home);
    assert.ok(existsSync(path.join(engine.dir, "tools", "youtube-media-worker.mjs")) && existsSync(path.join(engine.dir, ".ready")));
    assert.ok(existsSync(engine.python), "a Python environment for the engine's packages");
    assert.ok(readdirSync(path.join(engine.dir, "engine", "pkg", "tools", "myin_pipeline")).includes(tone.normalize("NFC")),
      "Korean names come back composed, as on the render PC (Windows finds 톤앤매너.json only by that spelling)");
    const env = runner.workerEnv(engine, home, "bos_pat_x");
    assert.equal(env.MYIN_PKG, path.join(engine.dir, "engine", "pkg"));
    assert.equal("MYIN_DIAGRAM_DIR" in env, false, "a folder the render PC did not have is not set, so both fingerprints agree");
    assert.equal(env.MYIN_LOCAL_KEY, "bos_pat_x");
  } finally { server.close(); delete process.env.MYIN_LOCAL_PYTHON; }
});
