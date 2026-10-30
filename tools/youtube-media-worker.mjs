/**
 * Narrated-video media worker. Runs on the owner's Mac during development and in
 * Vercel Sandbox later; either way it holds only OS_URL and YOUTUBE_MEDIA_WORKER_SECRET.
 * The OS verifies every input; this process stitches audio, draws the video with Logan's mind-map
 * package (kept outside Git: code, fonts and sounds from his reproduction zip) and uploads it.
 *
 * OS_URL=https://<preview> YOUTUBE_MEDIA_WORKER_SECRET=... MINDMAP_DIR=<unzipped package> MINDMAP_PYTHON=<python with numpy, Pillow>
 * MINDMAP_FFMPEG=<ffmpeg with libass> HAN_BATANG=<serif font for quote decks> node tools/youtube-media-worker.mjs [--once] [--run <voice run id>]
 * --run limits both the voice steps and the render claim to one voice run, so older queued runs are left alone.
 * Once a minute it reports disk, memory and the current step to the OS (렌더 PC 상태); with under 60 GB free it takes no new render.
 *
 * 내 컴퓨터로 시안 (owner decision 2026-10-27): on a member's own Mac, `--local` with OS_URL, MYIN_LOCAL_KEY (their 「내 컴퓨터 렌더」
 * key, never the render PC's secret) and the same MYIN_PKG / MYIN_DIAGRAM_DIR / MYIN_PYTHON as the render PC makes only the ③ drafts
 * that member sent to their computer. It rebuilds each run's work folder from the OS (stage 1's Fish paragraphs and frozen words), and
 * the OS hands it work only while its engine fingerprint equals the render PC's.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { constants as fsConstants, appendFileSync,closeSync,copyFileSync, cpSync, existsSync, openSync, readSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shortformDiagramCapabilities } from "./shortform-diagrams.mjs";
import { checkShortformRuntime,renderShortform } from "./shortform-renderer.mjs";

const osUrl = (process.env.OS_URL ?? "").replace(/\/$/, "");
const local = process.argv.includes("--local");
const secret = (local ? process.env.MYIN_LOCAL_KEY : process.env.YOUTUBE_MEDIA_WORKER_SECRET) ?? "";
const mediaRoute = local ? "local-render" : "media";
const runArg = process.argv.indexOf("--run");
const runId = runArg > 0 ? process.argv[runArg + 1] : undefined;
const mindmapDir = process.env.MINDMAP_DIR ?? "";
const GAP = 0.45; // Logan's pause between paragraphs; his timings and renderer assume it.
const MIN_DISK_GB = 60; // one render decodes about 45 GB of deck frames under MINDMAP_DIR
let current = null; // { renderId?, step } while working, for the heartbeat

const gb = (bytes) => Math.round(bytes / 1e8) / 10;
const diskFreeGb = () => { const { bavail, bsize } = statfsSync(mindmapDir || os.tmpdir()); return gb(bavail * bsize); };
/** 렌더 PC 상태: never stops the worker if the OS is unreachable or older. */
export async function heartbeat() {
  const answer = await call({ action: "heartbeat", diskFreeGb: diskFreeGb(), memUsedGb: gb(os.totalmem() - os.freemem()), memTotalGb: gb(os.totalmem()), job: current,
    packageName: (process.env.MINDMAP_PACKAGE_NAME || path.basename(path.resolve(local ? myinPkg : mindmapDir, ".."))).slice(0, 80),
    ...(engine() ? { engine: engine() } : {}) }).catch((error) => { console.error(`heartbeat: ${error.message}`); return null; });
  // The OS has no bundle of this engine for staff PCs yet: pack and upload it while nothing renders (render PC only).
  if (!local && answer?.engineBundle === false && !current && !enginePublish && Date.now() >= enginePublishAfter)
    enginePublish = publishEngine().catch((error) => { console.error(`engine bundle: ${error.message}`); enginePublishAfter = Date.now() + 60 * 60_000; })
      .finally(() => { enginePublish = null; });
}

// 내 컴퓨터로 시안: the engine bundle for staff PCs, packed by tools/myin-engine-pack.sh and uploaded in parts. A failure waits
// an hour before the next try, so a missing bucket or a full disk never repacks every minute.
const ENGINE_PART_BYTES = 45_000_000;
let enginePublish = null, enginePublishAfter = 0;
export async function publishEngine() {
  const pack = path.join(path.dirname(fileURLToPath(import.meta.url)), "myin-engine-pack.sh");
  if (!existsSync(pack) || !engine()) return;
  const out = await runCapture("nice", ["-n", "19", "zsh", pack], { env: { ...process.env, MYIN_LIBRARY: myinLibrary, WORKER_PATH: fileURLToPath(import.meta.url) } });
  const file = out.match(/^BUNDLE=(.+)$/m)?.[1], python = out.match(/^PYTHON=(\d+\.\d+)$/m)?.[1];
  if (!file || !python || !path.basename(file).includes(engine())) throw new Error("the pack script did not make this engine's bundle");
  const bytes = statSync(file).size, count = Math.ceil(bytes / ENGINE_PART_BYTES);
  const { urls } = await call({ action: "engine_upload", fingerprint: engine(), parts: count });
  const parts = [], dir = mkdtempSync(path.join(os.tmpdir(), "myin-engine-")), fd = openSync(file, "r");
  try {
    for (let n = 0; n < count; n++) {
      const chunk = Buffer.alloc(Math.min(ENGINE_PART_BYTES, bytes - n * ENGINE_PART_BYTES));
      readSync(fd, chunk, 0, chunk.length, n * ENGINE_PART_BYTES);
      const part = path.join(dir, `part${n}.bin`);
      writeFileSync(part, chunk);
      await upload(urls[n], part, "application/octet-stream");
      rmSync(part);
      parts.push({ bytes: chunk.length, sha256: createHash("sha256").update(chunk).digest("hex") });
    }
  } finally { closeSync(fd); rmSync(dir, { recursive: true, force: true }); }
  await call({ action: "engine_ready", fingerprint: engine(), python, parts });
  console.log(`engine bundle for staff PCs: ${engine()} (${count} parts, ${gb(bytes)} GB)`);
}

async function call(body, route = mediaRoute) {
  const response = await fetch(`${osUrl}/api/v1/content/youtube-automation/${route}`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error?.message ?? `OS ${response.status}`), { code: json.error?.code ?? `HTTP_${response.status}` });
  return json;
}

async function fetchTo(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error(`download ${response.status}`), { code: "WORKER_DOWNLOAD_FAILED" });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

// P01 (10 min, ~40 MB) rendered fine twice and lost both attempts to a dropped PUT ("fetch failed"). A network blip or a 5xx
// is retried here instead of costing a 13-minute re-render. ponytail: one whole-file PUT; resumable upload if videos outgrow it.
async function upload(url, file, contentType) {
  const body = readFileSync(file);
  for (const wait of [0, 10_000, 30_000]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    let response;
    try { response = await fetch(url, { method: "PUT", headers: { "content-type": contentType, "x-upsert": "true" }, body }); }
    catch (error) {
      console.error(`upload ${path.basename(file)} (${gb(body.length)} GB): ${error.message}${error.cause ? ` · ${error.cause.code ?? error.cause.message}` : ""}`);
      if (wait === 30_000) throw Object.assign(new Error(`upload: ${error.message}`), { code: "WORKER_UPLOAD_NETWORK" });
      continue;
    }
    if (response.ok) return;
    if ((response.status < 500 && ![408, 429].includes(response.status)) || wait === 30_000)
      throw Object.assign(new Error(`upload ${response.status}: ${(await response.text()).slice(0, 200)}`), { code: response.status === 413 ? "WORKER_UPLOAD_TOO_LARGE" : "WORKER_UPLOAD_FAILED" });
    console.error(`upload ${path.basename(file)}: HTTP ${response.status}, retrying`);
  }
}

const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" }));

/** Process one render job; returns false when the queue is empty. */
export async function processOne() {
  if (diskFreeGb() < MIN_DISK_GB) { console.error(`disk low (${diskFreeGb()} GB free): not taking a render`); return false; }
  const job = await call({ action: "claim", ...(runId && { voiceRunId: runId }) });
  if (job.idle) return false;
  current = { renderId: job.renderId, step: "download" };
  void heartbeat();
  const dir = mkdtempSync(path.join(os.tmpdir(), "brandyaction-render-"));
  const lease = { renderId: job.renderId, lease: job.lease };
  try {
    const parts = [];
    for (const segment of job.segments) {
      const file = path.join(dir, `segment-${String(segment.index).padStart(3, "0")}.mp3`);
      await fetchTo(segment.url, file);
      parts.push(file);
    }
    current.step = "narration";
    writeFileSync(path.join(dir, "parts.txt"), parts.map((file) => `file '${file}'`).join("\n"));
    const narration = path.join(dir, "narration.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "parts.txt"), "-c", "copy", narration]);
    await upload(job.audioUploadUrl, narration, "audio/mpeg");
    const render = await call({ action: "brief", ...lease, segmentDurations: parts.map(seconds), durationSeconds: seconds(narration) });
    current.step = "drawing";
    const video = await drawMindmap(render.brief, parts, job.renderId);
    current.step = "upload";
    await upload(render.videoUploadUrl, video, "video/mp4");
    const bytes = readFileSync(video);
    const done = { action: "complete", ...lease, videoBytes: bytes.length, videoSha256: createHash("sha256").update(bytes).digest("hex") };
    // The video is already up; a dropped "complete" must not throw the render away.
    await call(done).catch((error) => error.code?.startsWith("HTTP_4") || error.code?.startsWith("RENDER_") ? Promise.reject(error)
      : new Promise((resolve) => setTimeout(resolve, 10_000)).then(() => call(done)));
    console.log(`render ready: ${job.renderId}`);
  } catch (error) {
    console.error(`render failed: ${job.renderId}: ${error.message}${error.cause ? ` · cause: ${error.cause.code ?? error.cause.message}` : ""}`);
    await call({ action: "fail", ...lease, code: String(error.code ?? "WORKER_RENDER_FAILED") }).catch(() => {});
  } finally {
    current = null;
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.join(mindmapDir, "voice", job.renderId), { recursive: true, force: true }); // ~45 GB of decoded deck frames
  }
  return true;
}

/**
 * Lay out Logan's work folder (voice.wav, timings, plan with the OS's decks and sections, items) and run
 * his stages 2, 5a, 4a, 4b, 5b and 6 exactly as his manual does. Returns the finished MP4's path.
 */
export async function drawMindmap(brief, parts, name) {
  const work = path.join(mindmapDir, "voice", name);
  mkdirSync(work, { recursive: true });
  const wavs = parts.map((file, index) => {
    const wav = path.join(work, `p${String(index).padStart(2, "0")}.wav`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    return wav;
  });
  const silence = path.join(work, "sil.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(GAP), "-c:a", "pcm_s16le", silence]);
  writeFileSync(path.join(work, "list.txt"), wavs.map((wav) => `file '${wav}'\nfile '${silence}'`).join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c:a", "pcm_s16le", path.join(work, "voice.wav")]);
  let start = 0;
  const paragraphs = brief.beats.map((beat, i) => {
    const dur = seconds(wavs[i]);
    const paragraph = { i, start: Number(start.toFixed(2)), dur: Number(dur.toFixed(2)), text: beat.text };
    start += dur + GAP;
    return paragraph;
  });
  writeFileSync(path.join(work, "timings.json"), JSON.stringify({ sections: brief.sections, paragraphs, total: Number(start.toFixed(2)) }));
  const stages = path.join(mindmapDir, "tools", "mindmap_pipeline");
  // ponytail: Logan's code is Windows-first (finds ffprobe by renaming "ffmpeg.exe", subtitle fonts in voice/fonts); shim both instead of forking it.
  const shim = mkdtempSync(path.join(os.tmpdir(), "mindmap-bin-"));
  symlinkSync(process.env.MINDMAP_FFMPEG || execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim(), path.join(shim, "ffmpeg.exe"));
  symlinkSync(execFileSync("which", ["ffprobe"], { encoding: "utf8" }).trim(), path.join(shim, "ffprobe.exe"));
  const fonts = path.join(mindmapDir, "voice", "fonts");
  if (!existsSync(fonts)) symlinkSync(path.join(mindmapDir, "assets", "repro", "fonts"), fonts);
  // Stages run without blocking so the once-a-minute heartbeat keeps going: a 10-minute video renders for ~13 minutes, and a
  // blocking call left 렌더 PC showing "연결 끊김" the whole time.
  const stage = (script, env = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.env.MINDMAP_PYTHON || "python3", [script, name],
      { cwd: stages, stdio: "inherit", env: { ...process.env, FFMPEG: path.join(shim, "ffmpeg.exe"), ...env } });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`${script} exited with ${code}`), { code: "WORKER_STAGE_FAILED" })));
  });
  try {
    await stage("stage_plan.py");
    // Logan's stage 2 builds the mind-map tree; the decks and sections are the OS design, not his defaults.
    const plan = JSON.parse(readFileSync(path.join(work, "plan.json"), "utf8"));
    plan.sections = brief.sections;
    plan.beats.forEach((beat, i) => Object.assign(beat, { deck: brief.beats[i].deck, section: brief.beats[i].section }));
    writeFileSync(path.join(work, "plan.json"), JSON.stringify(plan));
    writeFileSync(path.join(work, "items.json"), JSON.stringify(Object.fromEntries(plan.beats.map((beat, i) =>
      [beat.id, beat.deck === "35" ? brief.beats[i].items[0] : brief.beats[i].items]))));
    await stage("stage_subs.py");
    await stage("stage_decks.py");
    await stage("stage_render.py", { RES: "720", PARALLEL: "3", OFF: "3" });
    await stage("stage_audio.py", { NO_BGM: "1", OFF: "3" });
    const video = path.join(work, "final.mp4");
    await stage("stage_final.py", { NO_AD: "1", OFF: "3", VIDEO: path.join(work, "mindmap_video.mp4"), OUT: video });
    return video;
  } finally {
    rmSync(shim, { recursive: true, force: true });
  }
}

// 마이인 v13 stage 1 (design https://claude.ai/artifact/NCJ5qjYNeBYgfwjCnm1JgQ): Logan's package runs unchanged in a per-video APFS
// clone (his scripts write inside the package, and SRC defaults to an old video). The OS made each paragraph's wav exactly as his
// stage_voice would; placed as pNN.wav they make stage_voice skip Fish and only tighten and join, then words.json and subtitles.
const myinPkg = process.env.MYIN_PKG ?? "";
// 숏폼 (2026-10-28): a 9:16 copy of the same engine (Logan's code with the portrait patches, render PC only). With it set, this worker
// tells the OS it can take 숏폼 runs; their clone comes from it, and its V diagrams from MYIN_PORTRAIT_V_DIR (whose code finds the
// fonts only through MYIN_FONT_DIR: without it a diagram scene stopped the 2026-10-28 test with "cannot open resource").
const myinPkgShort = local ? "" : process.env.MYIN_PKG_SHORT ?? "";
const shortClaim = myinPkgShort ? { short: true } : {};
const layoutEnv = (env, layout) => layout === "short" ? { ...env, NO_HOLD: "1", MYIN_FONT_DIR: env.MYIN_FONT_DIR || path.join(myinPkgShort, "assets", "fonts"),
  ...(process.env.MYIN_PORTRAIT_V_DIR ? { PORTRAIT_V_DIR: process.env.MYIN_PORTRAIT_V_DIR } : {}) } : env;
// Logan's engine imports his diagrams (myin_dia, lib_*) only through PYTHONPATH: every Python step gets MYIN_DIAGRAM_DIR first, the
// folder the fingerprint hashes (2026-10-28 로건: a staff PC had it only for the catalog and stopped at the showreel cards).
if (process.env.MYIN_DIAGRAM_DIR) process.env.PYTHONPATH = [process.env.MYIN_DIAGRAM_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
// 내 컴퓨터로 시안 runs on staff Macs and on Logan's Windows PC too: Homebrew's folder only on a Mac, and the engine copy is an
// APFS clone on a Mac (instant, no extra disk) and a plain copy elsewhere.
const withTools = (env) => process.platform === "darwin" ? { ...env, PATH: `/opt/homebrew/bin${path.delimiter}${env.PATH ?? ""}` } : env;
const copyEngine = (from, to) => process.platform === "darwin" ? execFileSync("cp", ["-c", "-R", from, to]) : cpSync(from, to, { recursive: true });
const myinWork = process.env.MYIN_WORK || path.join(os.homedir(), "myin", "work");
const myinPython = process.env.MYIN_PYTHON || "python3";
// 음악 창고 (owner decision 2026-10-19): tracks beyond the package's own assets/bgm live here and are copied into each run.
const myinLibrary = process.env.MYIN_LIBRARY || path.join(os.homedir(), "myin", "library");
/**
 * The v13 engine as a hash: Logan's package (code by content, fonts, sounds and images by name and size), the diagram package,
 * the font folder, the music library and the Python packages. A staff Mac with the same hash draws the same drafts as the
 * render PC. Computed once; an engine swap restarts the worker.
 */
let engineHash = null;
export function engine() {
  if (engineHash !== null || !myinPkg) return engineHash || "";
  const h = createHash("sha256");
  const code = /\.(py|json|md|txt|ass|svg|html|js|css|ya?ml)$/i;
  const walk = (root, dir = "") => {
    const here = path.join(root, dir);
    if (!existsSync(here)) return;
    // Korean names count the same whether a folder stores them composed (NFC) or decomposed (NFD, as a Mac's tar writes them).
    const names = readdirSync(here).map((name) => [name.normalize("NFC"), name]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [, name] of names) {
      if (name === "__pycache__" || name.startsWith(".")) continue;
      const rel = path.join(dir, name), full = path.join(root, rel), stat = statSync(full);
      if (stat.isDirectory()) walk(root, rel);
      else h.update(`${rel.split(path.sep).join("/").normalize("NFC")}\0${code.test(name) ? createHash("sha256").update(readFileSync(full)).digest("hex") : stat.size}\n`);
    }
  };
  for (const part of ["tools", "assets"]) { h.update(`#pkg/${part}\n`); walk(path.join(myinPkg, part)); }
  for (const [label, dir] of [["diagrams", process.env.MYIN_DIAGRAM_DIR], ["fonts", process.env.MYIN_FONT_DIR], ["library", myinLibrary]]) {
    h.update(`#${label}\n`);
    if (dir) walk(dir);
  }
  // This worker's own files go into the staff bundle too (myin-engine-pack.sh copies tools/*.mjs · *.py and the ../lib catalog),
  // so a release that changes only them still makes the render PC upload a new bundle and staff PCs take it (owner 2026-10-28).
  const tools = path.dirname(fileURLToPath(import.meta.url));
  h.update("#worker\n");
  for (const name of readdirSync(tools).filter((name) => /\.(mjs|py)$/.test(name)).sort()) h.update(`${name}\0${createHash("sha256").update(readFileSync(path.join(tools, name))).digest("hex")}\n`);
  const catalog = path.join(tools, "..", "lib", "shortform-diagram-catalog.json");
  if (existsSync(catalog)) h.update(`lib/shortform-diagram-catalog.json\0${createHash("sha256").update(readFileSync(catalog)).digest("hex")}\n`);
  // The packages his code imports, not pip itself (a fresh venv's pip differs and draws nothing), and the Python minor version.
  // -s: packages under the user's home are not the engine's (a venv never sees them, a bare python3 would).
  const pip = spawnSync(myinPython, ["-s", "-c", "import sys, subprocess; print('%d.%d' % sys.version_info[:2]); sys.stdout.flush(); subprocess.run([sys.executable, '-s', '-m', 'pip', 'freeze'])"],
    { encoding: "utf8", timeout: 60_000 });
  // Packages pip adds only on one system (colorama for click/tqdm on Windows, appnope on a Mac) draw nothing.
  const platformOnly = /^(colorama|pywin32|pywin32-ctypes|appnope|pyobjc[a-z0-9-]*)==/i;
  h.update(`#python\n${(pip.stdout ?? "").split(/\r?\n/).filter((line) => line && !platformOnly.test(line)).sort().join("\n")}`);
  engineHash = h.digest("hex").slice(0, 32);
  return engineHash;
}

// 도식 창고 목록 (owner decision 2026-10-22): what the installed v13 engine can draw, sent to the OS when it changes, so the
// storyboard staff AI picks only diagrams this PC renders. The script sits next to this file, like shortform-caption.py.
const catalogScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "myin-diagram-catalog.py");
let catalogSent = "";
export async function reportDiagramCatalog() {
  if (!myinPkg || !existsSync(catalogScript)) return;
  try {
    const result = spawnSync(myinPython, [catalogScript], { cwd: path.join(myinPkg, "tools", "myin_pipeline"), encoding: "utf8", maxBuffer: 8e6, timeout: 120_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    if (result.status !== 0) throw new Error(`catalog script exited with ${result.status}: ${String(result.stderr).slice(-300)}`);
    const hash = createHash("sha256").update(result.stdout).digest("hex");
    if (hash === catalogSent) return;
    const saved = await call(JSON.parse(result.stdout), "catalog");
    catalogSent = hash;
    console.log(`diagram catalog: ${saved.items} types`);
  } catch (error) { console.error(`diagram catalog: ${error.message}`); } // never stops the worker
}
const runAsync = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`${args[0]} exited with ${code}`), { code: "WORKER_STAGE_FAILED" })));
});

// 로건 호흡·타이밍 (2026-10-27): his breath model picks where 안저님 breathes mid-sentence; Fish (on the OS) reads those commas.
// Only word positions go back. A package without tools/voice_timing, or VOICE_TIMING=off, sends none and the voice is as before.
const BREATH_PY = `import sys, json, os
sys.path.insert(0, os.path.join(sys.argv[1], "tools", "voice_timing"))
import voice_timing as VT
out = []
for p in json.load(sys.stdin):
    a = p["text"].split(); b = VT.prepare_text(p["text"]).split()
    out.append({"index": p["index"], "after": [k for k, (x, y) in enumerate(zip(a, b)) if y == x + ","] if len(a) == len(b) else []})
print(json.dumps(out))`;
export function myinBreaths(paragraphs) {
  const none = paragraphs.map((p) => ({ index: p.index, after: [] }));
  if (process.env.VOICE_TIMING === "off" || !existsSync(path.join(myinPkg, "tools", "voice_timing", "voice_timing.py"))) return none;
  const result = spawnSync(myinPython, ["-c", BREATH_PY, myinPkg], { input: JSON.stringify(paragraphs), encoding: "utf8", maxBuffer: 8e6, timeout: 300_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (result.status !== 0) throw Object.assign(new Error(`breath model exited with ${result.status}: ${String(result.stderr).slice(-300)}`), { code: "WORKER_BREATH_FAILED" });
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

/** Process one v13 breath job; an OS without this step (older deploy) answers 400, which counts as no job. */
export async function processMyinBreath() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_breath_claim" }).catch(() => ({ idle: true }));
  if (job.idle) return false;
  const lease = { runId: job.runId, lease: job.lease };
  current = { step: "breath" };
  try {
    const breaths = myinBreaths(job.paragraphs);
    const saved = await call({ action: "myin_breath_complete", ...lease, breaths });
    console.log(`myin breath ready: ${job.runId} (${saved.commas} commas)`);
  } catch (error) {
    console.error(`myin breath failed: ${job.runId}: ${error.message}`);
    await call({ action: "myin_fail", ...lease, code: String(error.code ?? "WORKER_BREATH_FAILED") }).catch(() => {});
  } finally {
    current = null;
  }
  return true;
}

// 숏폼 레퍼런스 받기 (owner direction 2026-10-28: "썸네일 카피, 화면 첫 부분 헤드 카피가 가장 중요해"): each reference's thumbnail, a sheet
// of its first three seconds (two frames a second) and its words (faster-whisper small, as stage_words), then the video is deleted.
// Only the hosts the OS allows reach yt-dlp, after "--" so no link can pass as an option. Render PC only (staff PCs have no yt-dlp).
const REF_HOSTS = ["youtube.com", "youtu.be", "instagram.com", "facebook.com", "tiktok.com"];
const refHostOk = (link) => { try { const url = new URL(link); return url.protocol === "https:" && REF_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; } };
const REF_WORDS_PY = `import json, sys
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for path in sys.argv[1:]:
    segs, _ = m.transcribe(path, language="ko", vad_filter=True)
    out[path] = "\\n".join(f"{s.start:.1f} {s.text.strip()}" for s in segs)
print(json.dumps(out, ensure_ascii=False))`;
export async function processShortRefs() {
  const job = await call({ action: "short_refs_claim" }).catch(() => ({ idle: true }));
  if (job.idle) return false;
  const lease = { jobId: job.jobId, lease: job.lease };
  current = { step: "short_refs" };
  const dir = mkdtempSync(path.join(os.tmpdir(), "short-refs-"));
  const env = withTools(process.env);
  try {
    const results = [], wavs = new Map();
    for (const item of job.items) {
      const result = { index: item.index, ok: false, title: "", durationSeconds: null, transcript: "", thumb: false, sheet: false, error: "", views: null, likes: null, followers: null };
      results.push(result);
      if (!refHostOk(item.url)) { result.error = "받을 수 없는 주소예요"; continue; }
      const base = path.join(dir, `r${item.index}`);
      try {
        // The page's counts too (반응도 기준, 2026-10-28): yt-dlp prints NA for what a platform hides.
        // Only the allowed sites' own extractors (no generic or redirect pages), 2026-10-28 review.
        const printed = await runCapture("yt-dlp", ["--no-warnings", "--no-playlist", "--quiet", "--use-extractors", "youtube.*,instagram.*,tiktok.*,facebook.*", "--print", "after_move:%(title)s\t%(duration)s\t%(view_count)s\t%(like_count)s\t%(channel_follower_count)s", "--max-filesize", "150M",
          "--match-filter", "duration <= 600", "-f", "worst[height>=360]/worst", "--write-thumbnail", "--convert-thumbnails", "jpg", "-o", `${base}.%(ext)s`, "--", item.url], { env });
        // From the right: a tab inside a title must not shift the counts.
        const fields = printed.trim().split("\n").pop().split("\t");
        const [duration = "", views = "", likes = "", followers = ""] = fields.splice(-4);
        const title = fields.join(" ");
        const count = (value) => /^\d+$/.test(value) ? Number(value) : null;
        Object.assign(result, { title: title.slice(0, 300), durationSeconds: Number(duration) || null, views: count(views), likes: count(likes), followers: count(followers) });
        const video = readdirSync(dir).map((name) => path.join(dir, name)).find((file) => path.basename(file).startsWith(`r${item.index}.`) && !file.endsWith(".jpg"));
        if (!video) throw new Error("no video file");
        const sheet = `${base}-sheet.jpg`, wav = `${base}.wav`;
        spawnSync("ffmpeg", ["-v", "error", "-y", "-t", "3", "-i", video, "-vf", "fps=2,scale=360:-2,tile=3x2", "-frames:v", "1", sheet], { env });
        if (spawnSync("ffmpeg", ["-v", "error", "-y", "-t", "180", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav], { env }).status === 0) wavs.set(item.index, wav);
        rmSync(video, { force: true });
        if (existsSync(`${base}.jpg`)) { await upload(item.thumb, `${base}.jpg`, "image/jpeg"); result.thumb = true; }
        if (existsSync(sheet)) { await upload(item.sheet, sheet, "image/jpeg"); result.sheet = true; }
        result.ok = result.thumb || result.sheet;
        if (!result.ok) result.error = "화면을 뽑지 못했어요";
      } catch (error) {
        result.error = `영상을 받지 못했어요 (${String(error.message).slice(0, 120)})`;
      }
    }
    if (wavs.size) {
      const words = spawnSync(myinPython, ["-c", REF_WORDS_PY, ...wavs.values()], { encoding: "utf8", maxBuffer: 8e6, timeout: 900_000, env: { ...env, PYTHONIOENCODING: "utf-8" } });
      const said = words.status === 0 ? JSON.parse(words.stdout.trim().split("\n").pop()) : {};
      if (words.status !== 0) console.error(`short refs words: ${String(words.stderr).slice(-300)}`);
      for (const [index, wav] of wavs) { const result = results.find((row) => row.index === index); if (result) result.transcript = String(said[wav] ?? "").slice(0, 6000); }
    }
    const saved = await call({ action: "short_refs_complete", ...lease, results });
    console.log(`short refs ready: ${job.jobId} (${saved.ok}/${saved.of})`);
  } catch (error) {
    console.error(`short refs failed: ${job.jobId}: ${error.message}`);
    await call({ action: "short_refs_fail", ...lease, code: String(error.code ?? "WORKER_SHORT_REFS_FAILED") }).catch(() => {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
    current = null;
  }
  return true;
}

// 내 컴퓨터로 시안: his processed voice leaves the render PC byte for byte in parts under the voice bucket's 12 MB limit.
const VOICE_PART_BYTES = 10_000_000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function uploadVoiceParts(file, urls) {
  const bytes = readFileSync(file), parts = Math.ceil(bytes.length / VOICE_PART_BYTES);
  if (parts > urls.length) { console.error(`myin voice: ${parts} parts is more than ${urls.length}; this video's drafts stay on the render PC`); return null; }
  const dir = mkdtempSync(path.join(os.tmpdir(), "myin-voice-"));
  try {
    for (let i = 0; i < parts; i++) {
      const part = path.join(dir, `part${i}.wav`);
      writeFileSync(part, bytes.subarray(i * VOICE_PART_BYTES, (i + 1) * VOICE_PART_BYTES));
      await upload(urls[i], part, "audio/wav");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { parts, bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * 내 컴퓨터로 시안: the run's work folder as the render PC left it after stage 1 — a copy of the engine, its processed voice.wav
 * (downloaded, never recomputed: his sentence gaps come from a seeded random draw, so another run could shift every cue) and the
 * frozen transcription and subtitles.
 */
export async function myinRebuild(runId, seed) {
  const work = path.join(myinWork, runId), voiceDir = path.join(work, "voice", "os_voice"), videoDir = path.join(work, "voice", "os_myin");
  if (existsSync(path.join(videoDir, "words.json")) && existsSync(path.join(voiceDir, "voice.wav"))) return;
  if (!existsSync(work)) { mkdirSync(myinWork, { recursive: true }); copyEngine(myinPkg, work); }
  mkdirSync(voiceDir, { recursive: true }); mkdirSync(videoDir, { recursive: true });
  const parts = [];
  for (const url of seed.voice.urls) {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error(`voice part ${response.status}`), { code: "WORKER_DOWNLOAD_FAILED" });
    parts.push(Buffer.from(await response.arrayBuffer()));
  }
  const voice = Buffer.concat(parts);
  if (voice.length !== seed.voice.bytes || sha256(voice) !== seed.voice.sha256)
    throw Object.assign(new Error("voice.wav differs from the render PC's"), { code: "MYIN_VOICE_MISMATCH" });
  const response = await fetch(seed.wordsUrl);
  if (!response.ok) throw Object.assign(new Error(`words bundle ${response.status}`), { code: "WORKER_DOWNLOAD_FAILED" });
  const bundle = await response.json();
  writeFileSync(path.join(voiceDir, "voice.wav"), voice);
  writeFileSync(path.join(voiceDir, "speech.txt"), bundle.speech);
  writeFileSync(path.join(videoDir, "subs_myin.ass"), bundle.subtitlesAss);
  writeFileSync(path.join(videoDir, "subs_qc.md"), bundle.subtitleQc ?? "");
  writeFileSync(path.join(videoDir, "words.json"), JSON.stringify(bundle.words));
  console.log(`myin work folder rebuilt from the OS: ${runId}`);
}

/**
 * 로건 사람 말투 음성 (2026-10-29, OS 문서 A안): a run started with the OS's 「맥미니가 음성 만들기」 brings no voice files, and his patched
 * stage_voice asks Fish here sentence by sentence (two takes where the first breaks) with this PC's key (worker env FISH_API_KEY) and
 * the voice the OS sends. It no longer reuses the OS's paragraph files either, so an older run is voiced again the same way. Its
 * pause check needs torch · librosa · transformers, kept out of the render venv in MYIN_VOICE_PYTHON.
 */
export function myinVoiceEnv(job, base = process.env) {
  const onPc = job.paragraphs.every((paragraph) => !paragraph.url);
  const key = base.FISH_API_KEY?.trim() ?? "", voice = job.fishVoice?.referenceId?.trim() || base.FISH_VOICE_ID?.trim() || "";
  if (onPc && (!key || !voice)) throw Object.assign(new Error("this render PC has no Fish key or voice to make the voice"), { code: "MYIN_VOICE_KEY_MISSING" });
  // Without a key, his older stage_voice still only joins the OS files: placeholder keys pass its "keys present" check.
  return { onPc, python: base.MYIN_VOICE_PYTHON || myinPython,
    env: { ...base, PATH: `/opt/homebrew/bin:${base.PATH ?? ""}`, PYTHONIOENCODING: "utf-8", FISH_API_KEY: key || "unused", FISH_VOICE_ID: voice || "unused" } };
}

/** Like runAsync, but never throws: what the process printed (stdout and stderr) and whether it ended well. */
const runOut = (command, args, options) => new Promise((resolve) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { out += chunk; process.stderr.write(chunk); });
  child.on("error", (error) => resolve({ ok: false, out: error.message }));
  child.on("exit", (code) => resolve({ ok: code === 0, out }));
});
/** His Korean report lines (「찾은 문장: …」 · 「목소리 업데이트: …」 or why not), without the model-loading noise. */
export const fixReport = (out) => String(out).replace(/\r/g, "").split("\n").map((line) => line.trim())
  .filter((line) => /[가-힣]/.test(line) && !/Loading weights|Redirects are currently/.test(line)).slice(-4).join("\n").slice(0, 600);

/**
 * 음성 사전 (로건 OS 요청 2026-10-30): voice_fix adds to the run's own copy of his dictionaries (읽기사전 · 어색문장모음). Until the OS keeps
 * them, the new lines go back into the package so the next video reads them; lines already there win, nothing is removed.
 */
export function mergeVoiceDictionaries(fromDir, toDir) {
  const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
  const write = (file, value) => { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`); renameSync(tmp, file); };
  const readings = read(path.join(fromDir, "읽기사전.json")), liveReadings = read(path.join(toDir, "읽기사전.json"));
  const newReadings = readings && liveReadings ? Object.keys(readings).filter((key) => !(key in liveReadings)) : [];
  if (newReadings.length) write(path.join(toDir, "읽기사전.json"), { ...liveReadings, ...Object.fromEntries(newReadings.map((key) => [key, readings[key]])) });
  const tests = read(path.join(fromDir, "어색문장모음.json")), liveTests = read(path.join(toDir, "어색문장모음.json"));
  const ids = new Set((liveTests?.items ?? []).map((item) => item.id));
  const newTests = Array.isArray(tests?.items) && Array.isArray(liveTests?.items) ? tests.items.filter((item) => !ids.has(item.id)) : [];
  if (newTests.length) write(path.join(toDir, "어색문장모음.json"), { ...liveTests, items: [...liveTests.items, ...newTests] });
  return { readings: newReadings.length, tests: newTests.length };
}

/** 음성 사전 (phase ④): the run's copy reads what the OS keeps; his notes (keys starting with _, the file's 설명) stay. */
export function writeVoiceDictionaries(dir, dictionary) {
  const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
  const readings = read(path.join(dir, "읽기사전.json")), tests = read(path.join(dir, "어색문장모음.json"));
  const notes = Object.fromEntries(Object.entries(readings).filter(([key]) => key.startsWith("_")));
  writeFileSync(path.join(dir, "읽기사전.json"), `${JSON.stringify({ ...notes, ...dictionary.readings }, null, 1)}\n`);
  writeFileSync(path.join(dir, "어색문장모음.json"), `${JSON.stringify({ ...tests, items: dictionary.tests }, null, 1)}\n`);
}
/** The run's dictionaries after the voice, as the OS keeps them (notes left out), so lines voice_fix added reach the OS. */
export function readVoiceDictionaries(dir) {
  const read = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
  const readings = read(path.join(dir, "읽기사전.json")), tests = read(path.join(dir, "어색문장모음.json"));
  if (!readings && !tests) return null;
  return { readings: Object.fromEntries(Object.entries(readings ?? {}).filter(([key, value]) => !key.startsWith("_") && typeof value === "string")),
    tests: Array.isArray(tests?.items) ? tests.items : [] };
}

/** Process one v13 words job; returns false when there is none (or this PC has no v13 package). */
export async function processMyinWords() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_claim", ...shortClaim });
  if (job.idle) return false;
  current = { step: "download" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const work = path.join(myinWork, job.runId);
    if (!existsSync(work)) { mkdirSync(myinWork, { recursive: true }); execFileSync("cp", ["-c", "-R", job.layout === "short" ? myinPkgShort : myinPkg, work]); }
    const voiceJob = "os_voice", videoJob = "os_myin"; // fixed names: the clone belongs to this one video
    const voiceDir = path.join(work, "voice", voiceJob);
    mkdirSync(voiceDir, { recursive: true });
    const speaker = myinVoiceEnv(job);
    for (const paragraph of speaker.onPc ? [] : job.paragraphs) {
      const n = String(paragraph.index).padStart(2, "0");
      const raw = path.join(voiceDir, `p${n}_raw.wav`), pcm = path.join(voiceDir, `p${n}.wav`);
      if (existsSync(pcm)) continue;
      await fetchTo(paragraph.url, raw);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", pcm]); // his exact conversion
    }
    const script = path.join(voiceDir, "script.md");
    writeFileSync(script, job.scriptMarkdown);
    const { env } = speaker;
    // 음성 확인·수정 (로건 OS 요청 2026-10-30): memos redo only their sentences in this video's voice (his voice_fix); the rest stays.
    // A 최종 검토 memo (video) carries the video's time, which his time map from the last full render turns into the voice's.
    const fixes = Array.isArray(job.fixes) ? job.fixes : [];
    const timing = path.join(work, "tools", "voice_timing");
    const fixed = [];
    const hasVoice = existsSync(path.join(voiceDir, "voice.wav")), hasTool = existsSync(path.join(timing, "voice_fix.py"));
    if (job.dictionary && existsSync(timing)) writeVoiceDictionaries(timing, job.dictionary);
    if (fixes.length && hasVoice && hasTool) {
      current.step = "voice fix";
      for (const fix of fixes) {
        const result = await runOut(speaker.python, ["voice_fix.py", voiceJob, "--memo", fix.memo, ...(fix.say ? ["--say", fix.say] : []), ...(fix.read ? ["--read", fix.read] : []),
          ...(fix.video ? ["--video", "--video_work", videoJob] : [])], { cwd: timing, env });
        fixed.push({ memo: fix.memo, ok: result.ok, report: fixReport(result.out) });
      }
      // Without the OS's dictionary (an older OS) new lines go back into the package instead.
      if (fixed.some((fix) => fix.ok) && !job.dictionary) mergeVoiceDictionaries(timing, path.join(job.layout === "short" ? myinPkgShort : myinPkg, "tools", "voice_timing"));
    } else if (fixes.length) {
      // Never voice a whole video again for a memo: it stays as it was and the screen says why.
      const why = !hasTool ? "이 영상은 문장만 다시 만드는 도구가 없는 패키지로 시작했어요." : "영상 만드는 컴퓨터에 이 영상의 음성 작업 폴더가 없어요.";
      for (const fix of fixes) fixed.push({ memo: fix.memo, ok: false, report: why });
      if (!hasVoice) throw Object.assign(new Error("the voice to fix is gone from this render PC"), { code: "MYIN_VOICE_FIX_NO_VOICE" });
    } else {
      current.step = "narration";
      await runAsync(speaker.python, ["stage_voice.py", script, voiceJob], { cwd: path.join(work, "tools", "mindmap_pipeline"), env });
    }
    // 들어 볼 문장 (his voice_audit): every sentence scored for breaks and long runs, worst first; stage 1 lists the ones worth a listen.
    let audit = null;
    if (speaker.onPc && existsSync(path.join(timing, "voice_audit.py"))) {
      current.step = "voice check";
      const file = path.join(voiceDir, "audit.json");
      const result = await runOut(speaker.python, ["voice_audit.py", voiceDir, file], { cwd: timing, env });
      try { if (result.ok) audit = JSON.parse(readFileSync(file, "utf8")); } catch { audit = null; }
    }
    const speech = readFileSync(path.join(voiceDir, "speech.txt"), "utf8");
    const spoken = speech.replace(/\r/g, "").split("\n").filter((line) => line.trim() && !line.startsWith("#SECTION"));
    if (spoken.length !== job.paragraphs.length || spoken.some((text, i) => text !== job.paragraphs[i].text))
      throw Object.assign(new Error("speech.txt differs from the OS paragraphs"), { code: "MYIN_PARAGRAPHS_MISMATCH" });
    current.step = "drawing";
    const myinDir = path.join(work, "tools", "myin_pipeline");
    await runAsync(myinPython, ["stage_words.py", voiceJob, videoJob], { cwd: myinDir, env });
    await runAsync(myinPython, ["stage_subs_myin.py", voiceJob, videoJob, script], { cwd: myinDir, env });
    const out = path.join(work, "voice", videoJob);
    const bundle = path.join(out, "myin-words.json");
    writeFileSync(bundle, JSON.stringify({ words: JSON.parse(readFileSync(path.join(out, "words.json"), "utf8")),
      subtitlesAss: readFileSync(path.join(out, "subs_myin.ass"), "utf8"), subtitleQc: readFileSync(path.join(out, "subs_qc.md"), "utf8"),
      speech, durationSeconds: seconds(path.join(voiceDir, "voice.wav")), ...(Array.isArray(audit) ? { audit } : {}), ...(fixed.length ? { fixes: fixed } : {}),
      ...(readVoiceDictionaries(timing) ? { dictionary: readVoiceDictionaries(timing) } : {}) }));
    current.step = "upload";
    await upload(job.bundleUploadUrl, bundle, "application/json");
    // A staff Mac's ③ drafts need this exact voice; without it (older OS, too long, upload trouble) they stay on the render PC.
    const voice = job.voiceUploadUrls ? await uploadVoiceParts(path.join(voiceDir, "voice.wav"), job.voiceUploadUrls).catch((error) => {
      console.error(`myin voice upload skipped: ${job.runId}: ${error.message}`); return null; }) : null;
    // 음성 확인: a 64 kbps MP3 of the same voice to listen to on the screen (sent only to an OS that asked for it).
    let preview = null;
    if (job.previewUploadUrl) {
      const mp3 = path.join(voiceDir, "preview.mp3");
      try {
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(voiceDir, "voice.wav"), "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
        await upload(job.previewUploadUrl, mp3, "audio/mpeg");
        preview = { bytes: statSync(mp3).size };
      } catch (error) { console.error(`myin voice preview skipped: ${job.runId}: ${error.message}`); }
    }
    await call({ action: "myin_complete", ...lease, ...(voice ? { voice } : {}), ...(preview ? { preview } : {}) });
    console.log(`myin words ready: ${job.runId}${fixed.length ? ` (${fixed.filter((fix) => fix.ok).length}/${fixed.length} sentences fixed)` : ""}`);
  } catch (error) {
    console.error(`myin words failed: ${job.runId}: ${error.message}${error.cause ? ` · cause: ${error.cause.code ?? error.cause.message}` : ""}`);
    await call({ action: "myin_fail", ...lease, code: String(error.code ?? "WORKER_MYIN_FAILED") }).catch(() => {});
  } finally {
    current = null;
  }
  return true;
}

/** Like runAsync, and also returns what the process printed (Logan's scripts report "문구 못 찾음" only on stdout). */
const runCapture = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; process.stdout.write(chunk); });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve(out) : reject(Object.assign(new Error(`${args[0]} exited with ${code}`), { code: "WORKER_STAGE_FAILED" })));
});

// ③ 시안 (2026-10-27 대표): the drafts use the storyboard's photos; a gray 「사진 자리」 stands in only for one the render PC could not fetch
// (his engine stops on a missing file). The ④ preparation fetches the photo again under the same name over it.
const PLACEHOLDER_PY = `import os, sys
from PIL import Image, ImageDraw, ImageFont
out, name, fonts = sys.argv[1:4]
im = Image.new("RGB", (1600, 1000), (214, 214, 220)); d = ImageDraw.Draw(im)
def font(size):
    for n in ("Pretendard-Bold.otf", "Pretendard-SemiBold.otf", "Pretendard-Black.otf"):
        if os.path.exists(os.path.join(fonts, n)): return ImageFont.truetype(os.path.join(fonts, n), size)
    return ImageFont.load_default()
for text, size, y in (("사진 자리", 120, 360), (name, 48, 540), ("사진을 받지 못했어요 · 4단계 자료 준비에서 다시 받아요", 40, 620)):
    f = font(size); d.text(((1600 - d.textlength(text, font=f)) / 2, y), text, font=f, fill=(96, 96, 104))
im.save(out, quality=90)`;

// 사운드 창고 목록 (로건 2026-10-27): the music, effect and ambience keys this PC's package can play, sent like the diagram list so the
// ④ editor offers only sounds the render PC has. Keys as his storyboard writes them: music_09 · stamp_press · amb_cafe.
export function soundCatalog(pkg) {
  const read = (file) => existsSync(file) ? readFileSync(file, "utf8") : "";
  const table = (file) => new Map(read(file).split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 파일"))
    .map((line) => line.split("|").map((cell) => cell.trim())).map((cells) => [cells[1], cells.slice(2)]));
  const items = [];
  try {
    for (const song of JSON.parse(read(path.join(pkg, "assets", "bgm", "catalog.json")) || "[]")) {
      const key = String(song.file ?? "").match(/^(music_\d+)/)?.[1];
      const note = [song.slot, song.bright].filter(Boolean).join(" · ");
      if (key) items.push({ kind: "music", key, title: `${song.title ?? key}${song.artist ? ` · ${song.artist}` : ""}`.slice(0, 200), ...(note ? { note: note.slice(0, 200) } : {}) });
    }
  } catch { /* no song list: no music keys */ }
  for (const [kind, pattern] of [["sfx", /^sfx_(.+)_1\.(mp3|wav)$/], ["amb", /^(amb_.+)_1\.(mp3|wav)$/]]) {
    const folder = path.join(pkg, "assets", kind);
    if (!existsSync(folder)) continue;
    const credits = table(path.join(folder, "CREDITS.md"));
    for (const name of readdirSync(folder).sort()) {
      const key = name.match(pattern)?.[1];
      if (!key) continue;
      const [original = "", cell = ""] = credits.get(name) ?? [];
      const use = /mixkit/i.test(cell) ? "" : cell;   // Mixkit rows carry the source in the 쓰임 column
      items.push({ kind, key, title: (use || original || key).slice(0, 200), ...(use && original ? { note: original.slice(0, 200) } : {}) });
    }
  }
  return { items: items.slice(0, 600) };
}
let soundsSent = "";
export async function reportSoundCatalog() {
  if (!myinPkg) return;
  try {
    const catalog = soundCatalog(myinPkg);
    const hash = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    if (!catalog.items.length || hash === soundsSent) return;
    const saved = await call(catalog, "sounds");
    soundsSent = hash;
    console.log(`sound catalog: ${saved.items} sounds`);
  } catch (error) { console.error(`sound catalog: ${error.message}`); } // never stops the worker (an older OS answers 404)
}

/**
 * v13 stage 3 in the same clone: the confirmed storyboard, approved photos and music, the CTA lines (his ffmpeg line, his
 * tighten(), his md5 tag so stage_cta would say "그대로"), the site capture when a site_ad scene exists, then his preview,
 * whose "문구 못 찾음" lines and sheets go back to the OS.
 */
export async function processMyinPrep() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_prep_claim", ...(local ? { engine: engine() } : shortClaim) });
  if (job.idle) return false;
  current = { step: "download" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const work = path.join(myinWork, job.runId);
    if (job.seed) await myinRebuild(job.runId, job.seed);
    if (!existsSync(work)) throw Object.assign(new Error("no work folder for this run on this PC"), { code: "MYIN_WORK_MISSING" });
    const videoDir = path.join(work, "voice", "os_myin");
    const myinDir = path.join(work, "tools", "myin_pipeline");
    const env = layoutEnv(myinEnv(), job.layout);
    const storyFile = path.join(videoDir, "myin_storyboard.json");
    writeFileSync(storyFile, JSON.stringify(job.storyboard, null, 1));
    for (const spot of job.placeholders ?? []) {
      const file = path.join(work, "assets", spot.kind, spot.file);
      if (existsSync(file)) continue;
      mkdirSync(path.dirname(file), { recursive: true });
      execFileSync(myinPython, ["-c", PLACEHOLDER_PY, file, spot.file, path.join(work, "assets", "fonts")], { env });
    }
    // ③: Logan's music match writes 곡·앰비언스 keys into the storyboard; it and his report go back for the ④ editor. A package without
    // it (older run copies) or a failed match keeps the storyboard's own music. A 숏폼 has no music (pilots A1–A3: the voice alone).
    let soundReport;
    if (job.draft && job.layout !== "short" && existsSync(path.join(myinDir, "music_match.py"))) {
      try {
        await runAsync(myinPython, ["music_match.py", "os_myin", "--write"], { cwd: myinDir, env });
        soundReport = existsSync(path.join(videoDir, "음악매칭.md")) ? readFileSync(path.join(videoDir, "음악매칭.md"), "utf8") : "";
      } catch (error) {
        console.error(`myin music match failed: ${job.runId}: ${error.message}`);
        writeFileSync(storyFile, JSON.stringify(job.storyboard, null, 1));
      }
    }
    for (const asset of job.assets) {
      mkdirSync(path.join(work, "assets", asset.kind), { recursive: true });
      try { await fetchTo(asset.url, path.join(work, "assets", asset.kind, asset.file)); }
      catch (error) { if (!job.draft) throw error; console.error(`myin draft photo kept as 사진 자리: ${asset.file}: ${error.message}`); }   // ③ goes on
    }
    const bgmDir = path.join(work, "assets", "bgm");
    mkdirSync(bgmDir, { recursive: true });
    if (existsSync(path.join(myinLibrary, "bgm"))) for (const name of readdirSync(path.join(myinLibrary, "bgm")).filter((n) => n.endsWith(".mp3")))
      copyFileSync(path.join(myinLibrary, "bgm", name), path.join(bgmDir, name), fsConstants.COPYFILE_FICLONE);
    const music = [...Object.values(job.storyboard.music_cues ?? {}).map((cue) => cue.file), ...(job.storyboard.bgm ?? []).map((b) => b.file)].filter(Boolean);
    const missingMusic = [...new Set(music)].filter((file) => !existsSync(path.join(bgmDir, file))).map((file) => `음악 파일 없음(음악 창고에 없는 곡): ${file}`);
    const ctaDir = path.join(videoDir, "cta");
    mkdirSync(ctaDir, { recursive: true });
    for (const cta of job.cta.filter((line) => line.url)) {
      const k = String(cta.index).padStart(2, "0");
      const raw = path.join(ctaDir, `cta_${k}_raw.wav`), pcm = path.join(ctaDir, `cta_${k}_48k.wav`);
      await fetchTo(cta.url, raw);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", pcm]);
      await runAsync(myinPython, ["-c", "import sys, stage_voice as SV; SV.tighten(sys.argv[1], sys.argv[2])", pcm, path.join(ctaDir, `cta_${k}.wav`)],
        { cwd: path.join(work, "tools", "mindmap_pipeline"), env });
      writeFileSync(path.join(ctaDir, `cta_${k}.txt`), cta.tag);
    }
    // A render-PC voice run brings the lines without files: his stage_cta makes them like the narration (2026-10-29 로건).
    if (job.cta.some((line) => !line.url)) {
      const speaker = myinVoiceEnv({ paragraphs: [], fishVoice: job.fishVoice }, env);
      await runAsync(speaker.python, ["stage_cta.py", "os_myin"], { cwd: myinDir, env: speaker.env });
    }
    if (job.siteCapture) await runAsync(myinPython, ["capture_site.py"], { cwd: myinDir, env });
    current.step = "drawing";
    const log = await runCapture(myinPython, ["render_myin.py", "os_myin", "preview"], { cwd: myinDir, env });
    const misses = [...missingMusic, ...log.split("\n").filter((line) => line.includes("못 찾음"))];
    const sheets = readdirSync(videoDir).filter((name) => /^preview_\d+\.png$/.test(name)).sort().slice(0, job.sheetUploadUrls.length);
    current.step = "upload";
    for (const [i, name] of sheets.entries()) await upload(job.sheetUploadUrls[i], path.join(videoDir, name), "image/png");
    const bundle = path.join(videoDir, "myin-prep.json");
    // Credits for the music actually used, from the CREDITS.md lines kept next to the tracks (package and library).
    const creditLines = [path.join(bgmDir, "CREDITS.md"), path.join(myinLibrary, "bgm", "CREDITS.md")].filter(existsSync)
      .flatMap((file) => readFileSync(file, "utf8").split("\n")).map((line) => line.replace(/^-\s*/, "").trim());
    const musicCredits = [...new Set(music)].map((file) => creditLines.find((line) => line.startsWith(`${file} `)) ?? `${file} — 출처 기록 없음`);
    writeFileSync(bundle, JSON.stringify({ misses, sheets: sheets.length, musicCredits, log: log.slice(-20_000),
      ...(soundReport !== undefined ? { storyboard: JSON.parse(readFileSync(storyFile, "utf8")), soundReport } : {}) }));
    await upload(job.bundleUploadUrl, bundle, "application/json");
    await call({ action: "myin_prep_complete", ...lease });
    console.log(`myin prep ready: ${job.runId} (문구 못 찾음 ${misses.length})`);
  } catch (error) {
    console.error(`myin prep failed: ${job.runId}: ${error.message}${error.cause ? ` · cause: ${error.cause.code ?? error.cause.message}` : ""}`);
    await call({ action: "myin_prep_fail", ...lease, code: String(error.code ?? "WORKER_MYIN_FAILED") }).catch(() => {});
  } finally {
    current = null;
  }
  return true;
}

const myinEnv = () => withTools({ ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", SRC: "os_voice", STORY: "myin_storyboard.json" });
const myinDirs = (runId) => {
  const work = path.join(myinWork, runId);
  if (!existsSync(work)) throw Object.assign(new Error("no work folder for this run on this PC"), { code: "MYIN_WORK_MISSING" });
  return { work, videoDir: path.join(work, "voice", "os_myin"), myinDir: path.join(work, "tools", "myin_pipeline") };
};
// Scene times exactly as his renderer resolves them (source seconds, before holds): the clip ranges come from these.
const RESOLVE_PY = `import json, myin_engine as M
st = json.load(open("../../voice/os_myin/myin_storyboard.json", encoding="utf-8"))
w = json.load(open("../../voice/os_myin/words.json", encoding="utf-8"))
print("TIMES " + json.dumps([[s["t0"], s["t1"]] for s in M.resolve(st, w)]))`;

/** v13 stage 4a: his 720p clips of the opening with its reel and of each metaphor scene, for Logan to check before the full render. */
export async function processMyinClips() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_clips_claim", ...(local ? { engine: engine() } : shortClaim) });
  if (job.idle) return false;
  current = { step: "drawing" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    if (job.seed) await myinRebuild(job.runId, job.seed);
    const { videoDir, myinDir } = myinDirs(job.runId);
    const env = layoutEnv(myinEnv(), job.layout);
    const out = await runCapture(myinPython, ["-c", RESOLVE_PY], { cwd: myinDir, env });
    const times = JSON.parse(out.split("\n").find((line) => line.startsWith("TIMES ")).slice(6));
    const names = [];
    for (const clip of job.clips) {
      const [t0, t1] = times[clip.scene - 1];
      const [a, b] = clip.name === "clip_short" ? [0, times.at(-1)[1] + 0.3] : clip.name === "clip_opening" ? [0, times[1][0] + 0.3] : [Math.max(0, t0 - 0.5), t1 + 0.3];
      await runAsync(myinPython, ["render_myin.py", "os_myin", "clip", a.toFixed(2), b.toFixed(2), clip.name, "4"], { cwd: myinDir, env });
      current.step = "upload";
      await upload(clip.uploadUrl, path.join(videoDir, `${clip.name}.mp4`), "video/mp4");
      current.step = "drawing";
      names.push(clip.name);
    }
    await call({ action: "myin_clips_complete", ...lease, names });
    console.log(`myin clips ready: ${job.runId} (${names.length})`);
  } catch (error) {
    console.error(`myin clips failed: ${job.runId}: ${error.message}${error.cause ? ` · cause: ${error.cause.code ?? error.cause.message}` : ""}`);
    await call({ action: "myin_stage_fail", ...lease, code: String(error.code ?? "WORKER_MYIN_FAILED") }).catch(() => {});
  } finally {
    current = null;
  }
  return true;
}

/** v13 stage 4b: his full render, mix and handouts; the OS gets the video, 한장정리.png, 덱_전체.pdf, subs_youtube.srt and a loudness check. */
export async function processMyinFinal() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_final_claim", ...shortClaim });
  if (job.idle) return false;
  current = { step: "drawing" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const { work, videoDir, myinDir } = myinDirs(job.runId);
    const env = layoutEnv(myinEnv(), job.layout);
    // ④ sound edits made after the preparation reach the render in the storyboard the OS hands out with the job.
    if (job.storyboard) writeFileSync(path.join(videoDir, "myin_storyboard.json"), JSON.stringify(job.storyboard, null, 1));
    await runAsync(myinPython, ["render_myin.py", "os_myin", "render", "4"], { cwd: myinDir, env: { ...env, OUTNAME: "final_myin_v1_raw.mp4" } });
    const video = path.join(videoDir, "final_myin_v1.mp4");
    if (job.layout === "short") {
      // 숏폼: his picture with the voice alone, as the pilots A1–A3 (no music, no effects), brought to the longform's −14 LUFS
      // (the A1 pilot measured −16 LUFS, peak −0.5 dB); no handouts.
      const end = Number(job.storyboard?.end);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(videoDir, "myin_video_final_myin_v1_raw.mp4"), "-i", path.join(work, "voice", "os_voice", "voice.wav"),
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "pan=stereo|c0=c0|c1=c0,loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", ...(end > 0 ? ["-t", String(end)] : []), video], { env });
    } else {
      await runAsync(myinPython, ["render_myin.py", "os_myin", "remix", "../../voice/os_myin/myin_video_final_myin_v1_raw.mp4", "final_myin_v1.mp4"], { cwd: myinDir, env });
      await runAsync(myinPython, ["render_myin.py", "os_myin", "handouts"], { cwd: myinDir, env });
    }
    // Per-frame lines go to the verbose log: a 12-minute video printed 1.2 MB of them and overflowed spawnSync's buffer before the summary.
    const report = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 }).stderr ?? "";
    const last = (pattern) => Number([...report.matchAll(pattern)].at(-1)?.[1]);
    const lufs = last(/\bI:\s+(-?\d+(?:\.\d+)?) LUFS/g), peak = last(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g);
    if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw Object.assign(new Error("loudness check did not run"), { code: "MYIN_LOUDNESS_UNKNOWN" });
    current.step = "upload";
    await upload(job.videoUploadUrl, video, "video/mp4");
    if (job.summaryUploadUrl) await upload(job.summaryUploadUrl, path.join(videoDir, "handouts", "한장정리.png"), "image/png");
    if (job.deckUploadUrl) await upload(job.deckUploadUrl, path.join(videoDir, "handouts", "덱_전체.pdf"), "application/pdf");
    await upload(job.srtUploadUrl, path.join(videoDir, "subs_youtube.srt"), "application/x-subrip");
    await call({ action: "myin_final_complete", ...lease, bytes: readFileSync(video).length, durationSeconds: seconds(video), lufs, peak });
    console.log(`myin final ready: ${job.runId} (${lufs} LUFS, peak ${peak})`);
  } catch (error) {
    console.error(`myin final failed: ${job.runId}: ${error.message}${error.cause ? ` · cause: ${error.cause.code ?? error.cause.message}` : ""}`);
    await call({ action: "myin_stage_fail", ...lease, code: String(error.code ?? "WORKER_MYIN_FAILED") }).catch(() => {});
  } finally {
    current = null;
  }
  return true;
}

export async function processShortform(){
  if(runId||diskFreeGb()<2)return false;
  checkShortformRuntime();
  // layoutVersion 4 renders 1:1 and 4:5 feed ads as well as 9:16 (owner requests 2026-10-25); an older worker only gets the sizes it draws.
  const diagramTypes=shortformDiagramCapabilities();
  const onlyRenderId=process.env.SHORTFORM_RENDER_ID;
  const job=await call({action:"shorts_claim",layoutVersion:4,...(onlyRenderId?{renderId:onlyRenderId}:{}),...(diagramTypes.length?{diagramTypes}:{})});
  if(job.idle)return false;
  const dir=mkdtempSync(path.join(os.tmpdir(),"brandyaction-shorts-")),lease={renderId:job.renderId,lease:job.lease};
  current={renderId:job.renderId,step:"drawing"};void heartbeat();
  try{
    const sourceFile=job.mode==="reuse"?path.join(dir,"source.mp4"):undefined;
    if(sourceFile)await fetchShortformTo(job.sourceUrl,sourceFile,1_000_000_000);
    const scenes=[];
    for(const [index,scene] of job.scenes.entries()){
      const input={...scene};
      if(scene.imageUrl){input.imageFile=path.join(dir,`image-${index}`);await fetchShortformTo(scene.imageUrl,input.imageFile,25_000_000);}
      if(job.mode==="direct"&&scene.hasVoice){
        const audio=await call({action:"shorts_voice",...lease,index});
        input.audioFile=path.join(dir,`voice-${index}.mp3`);await fetchShortformTo(audio.url,input.audioFile,12*1024*1024);
      }
      scenes.push(input);
    }
    const result=await renderShortform({mode:job.mode,scenes,sourceFile,dir,aspect:job.aspect??"9:16"});
    await upload(job.uploadUrl,result.file,"video/mp4");
    const bytes=readFileSync(result.file);
    await call({action:"shorts_complete",...lease,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),duration:result.duration});
    console.log(`shortform ready: ${job.renderId}`);
  }catch(error){
    const code=String(error.code??"SHORTFORM_RENDER_FAILED");
    console.error(`shortform failed: ${job.renderId}: ${code}`);
    await call({action:"shorts_fail",...lease,code}).catch(()=>{});
  }finally{current=null;rmSync(dir,{recursive:true,force:true});}
  return true;
}
async function fetchShortformTo(url,file,max){
  const response=await fetch(url,{signal:AbortSignal.timeout(180_000)});
  if(!response.ok||!response.body||Number(response.headers.get("content-length"))>max)
    throw Object.assign(new Error("download rejected"),{code:"SHORTFORM_DOWNLOAD_FAILED"});
  const reader=response.body.getReader();let size=0;writeFileSync(file,"");
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;
      size+=value.length;if(size>max)throw Object.assign(new Error("download too large"),{code:"SHORTFORM_DOWNLOAD_TOO_LARGE"});
      appendFileSync(file,value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** A member's own Mac: only the ③ drafts they sent to it, one step at a time; nothing of the render PC's queue or catalogs. */
async function runLocal() {
  if (!osUrl.startsWith("https://") || !secret.startsWith("bos_pat_")) throw new Error("OS_URL (https) and MYIN_LOCAL_KEY (내 컴퓨터 렌더 키) are required");
  if (!existsSync(path.join(myinPkg, "tools", "myin_pipeline", "render_myin.py"))) throw new Error("MYIN_PKG must point at the same v13 engine as the render PC");
  console.log(`내 컴퓨터 렌더: engine ${engine()}`);
  void heartbeat();
  setInterval(() => void heartbeat(), 60_000).unref();
  do {
    const worked = await processMyinPrep().then((done) => done || processMyinClips()).catch((error) => {
      // The render PC moved to another engine: exit 3 between jobs, so the runner (public/myin-local) installs it and starts again.
      if (error.code === "MYIN_ENGINE_DIFFERENT") { console.error(`${error.message} (engine ${engine()})`); process.exit(3); }
      console.error(error.message);
      return false;
    });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && local) await runLocal();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!osUrl.startsWith("https://") || secret.length < 32) throw new Error("OS_URL (https) and YOUTUBE_MEDIA_WORKER_SECRET are required");
  const shortsOnly=process.argv.includes("--shorts-only");
  if (!shortsOnly&&!existsSync(path.join(mindmapDir, "tools", "mindmap_pipeline", "stage_render.py"))) throw new Error("MINDMAP_DIR must point at Logan's unzipped mind-map package");
  void heartbeat();
  setInterval(() => void heartbeat(), 60_000).unref();
  void reportDiagramCatalog();
  setInterval(() => void reportDiagramCatalog(), 60 * 60_000).unref();
  void reportSoundCatalog();
  setInterval(() => void reportSoundCatalog(), 60 * 60_000).unref();
  do {
    // No render ready? Advance the voice queue one step (review or one paragraph) so no separate scheduler is needed.
    const worked = await (shortsOnly?processShortform():processOne().then((rendered) => rendered || processMyinBreath()).then((rendered) => rendered || processShortRefs()).then((rendered) => rendered || processMyinWords()).then((rendered) => rendered || processMyinPrep())
      .then((rendered) => rendered || processMyinClips()).then((rendered) => rendered || processMyinFinal()).then((rendered) => rendered || (current = { step: "voice" }, call(runId ? { runId } : {}, "worker")).then((step) => {
      if (step.processed) console.log(`voice step: ${JSON.stringify(step).slice(0, 300)}`);
      return step.processed;
    }).finally(() => { current = null; })).then(rendered=>rendered||processShortform()))
      .catch((error) => { console.error(error.message); return false; });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}
