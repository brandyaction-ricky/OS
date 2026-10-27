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
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { constants as fsConstants, appendFileSync,copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shortformDiagramCapabilities } from "./shortform-diagrams.mjs";
import { checkShortformRuntime,renderShortform } from "./shortform-renderer.mjs";

const osUrl = (process.env.OS_URL ?? "").replace(/\/$/, "");
const secret = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
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
  await call({ action: "heartbeat", diskFreeGb: diskFreeGb(), memUsedGb: gb(os.totalmem() - os.freemem()), memTotalGb: gb(os.totalmem()), job: current,
    packageName: (process.env.MINDMAP_PACKAGE_NAME || path.basename(path.resolve(mindmapDir, ".."))).slice(0, 80) }).catch((error) => console.error(`heartbeat: ${error.message}`));
}

async function call(body, route = "media") {
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
const myinWork = process.env.MYIN_WORK || path.join(os.homedir(), "myin", "work");
const myinPython = process.env.MYIN_PYTHON || "python3";
// 음악 창고 (owner decision 2026-10-19): tracks beyond the package's own assets/bgm live here and are copied into each run.
const myinLibrary = process.env.MYIN_LIBRARY || path.join(os.homedir(), "myin", "library");
// 도식 창고 목록 (owner decision 2026-10-22): what the installed v13 engine can draw, sent to the OS when it changes, so the
// storyboard staff AI picks only diagrams this PC renders. The script sits next to this file, like shortform-caption.py.
const catalogScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "myin-diagram-catalog.py");
let catalogSent = "";
export async function reportDiagramCatalog() {
  if (!myinPkg || !existsSync(catalogScript)) return;
  try {
    const result = spawnSync(myinPython, [catalogScript], { cwd: path.join(myinPkg, "tools", "myin_pipeline"), encoding: "utf8", maxBuffer: 8e6, timeout: 120_000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONPATH: [process.env.MYIN_DIAGRAM_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
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

/** Process one v13 words job; returns false when there is none (or this PC has no v13 package). */
export async function processMyinWords() {
  if (!myinPkg) return false;
  const job = await call({ action: "myin_claim" });
  if (job.idle) return false;
  current = { step: "download" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const work = path.join(myinWork, job.runId);
    if (!existsSync(work)) { mkdirSync(myinWork, { recursive: true }); execFileSync("cp", ["-c", "-R", myinPkg, work]); }
    const voiceJob = "os_voice", videoJob = "os_myin"; // fixed names: the clone belongs to this one video
    const voiceDir = path.join(work, "voice", voiceJob);
    mkdirSync(voiceDir, { recursive: true });
    for (const paragraph of job.paragraphs) {
      const n = String(paragraph.index).padStart(2, "0");
      const raw = path.join(voiceDir, `p${n}_raw.wav`), pcm = path.join(voiceDir, `p${n}.wav`);
      if (existsSync(pcm)) continue;
      await fetchTo(paragraph.url, raw);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", pcm]); // his exact conversion
    }
    const script = path.join(voiceDir, "script.md");
    writeFileSync(script, job.scriptMarkdown);
    // Dummy keys only pass his "keys present" check; every pNN.wav exists, so no Fish call is made.
    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`, PYTHONIOENCODING: "utf-8", FISH_API_KEY: "unused", FISH_VOICE_ID: "unused" };
    current.step = "narration";
    await runAsync(myinPython, ["stage_voice.py", script, voiceJob], { cwd: path.join(work, "tools", "mindmap_pipeline"), env });
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
      speech, durationSeconds: seconds(path.join(voiceDir, "voice.wav")) }));
    current.step = "upload";
    await upload(job.bundleUploadUrl, bundle, "application/json");
    await call({ action: "myin_complete", ...lease });
    console.log(`myin words ready: ${job.runId}`);
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
  const job = await call({ action: "myin_prep_claim" });
  if (job.idle) return false;
  current = { step: "download" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const work = path.join(myinWork, job.runId);
    if (!existsSync(work)) throw Object.assign(new Error("no work folder for this run on this PC"), { code: "MYIN_WORK_MISSING" });
    const videoDir = path.join(work, "voice", "os_myin");
    const myinDir = path.join(work, "tools", "myin_pipeline");
    const env = { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", SRC: "os_voice", STORY: "myin_storyboard.json" };
    const storyFile = path.join(videoDir, "myin_storyboard.json");
    writeFileSync(storyFile, JSON.stringify(job.storyboard, null, 1));
    for (const spot of job.placeholders ?? []) {
      const file = path.join(work, "assets", spot.kind, spot.file);
      if (existsSync(file)) continue;
      mkdirSync(path.dirname(file), { recursive: true });
      execFileSync(myinPython, ["-c", PLACEHOLDER_PY, file, spot.file, path.join(work, "assets", "fonts")], { env });
    }
    // ③: Logan's music match writes 곡·앰비언스 keys into the storyboard; it and his report go back for the ④ editor. A package without
    // it (older run copies) or a failed match keeps the storyboard's own music.
    let soundReport;
    if (job.draft && existsSync(path.join(myinDir, "music_match.py"))) {
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
    for (const cta of job.cta) {
      const k = String(cta.index).padStart(2, "0");
      const raw = path.join(ctaDir, `cta_${k}_raw.wav`), pcm = path.join(ctaDir, `cta_${k}_48k.wav`);
      await fetchTo(cta.url, raw);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", pcm]);
      await runAsync(myinPython, ["-c", "import sys, stage_voice as SV; SV.tighten(sys.argv[1], sys.argv[2])", pcm, path.join(ctaDir, `cta_${k}.wav`)],
        { cwd: path.join(work, "tools", "mindmap_pipeline"), env });
      writeFileSync(path.join(ctaDir, `cta_${k}.txt`), cta.tag);
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

const myinEnv = () => ({ ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", SRC: "os_voice", STORY: "myin_storyboard.json" });
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
  const job = await call({ action: "myin_clips_claim" });
  if (job.idle) return false;
  current = { step: "drawing" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const { videoDir, myinDir } = myinDirs(job.runId);
    const env = myinEnv();
    const out = await runCapture(myinPython, ["-c", RESOLVE_PY], { cwd: myinDir, env });
    const times = JSON.parse(out.split("\n").find((line) => line.startsWith("TIMES ")).slice(6));
    const names = [];
    for (const clip of job.clips) {
      const [t0, t1] = times[clip.scene - 1];
      const [a, b] = clip.name === "clip_opening" ? [0, times[1][0] + 0.3] : [Math.max(0, t0 - 0.5), t1 + 0.3];
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
  const job = await call({ action: "myin_final_claim" });
  if (job.idle) return false;
  current = { step: "drawing" };
  const lease = { runId: job.runId, lease: job.lease };
  try {
    const { videoDir, myinDir } = myinDirs(job.runId);
    const env = myinEnv();
    // ④ sound edits made after the preparation reach the render in the storyboard the OS hands out with the job.
    if (job.storyboard) writeFileSync(path.join(videoDir, "myin_storyboard.json"), JSON.stringify(job.storyboard, null, 1));
    await runAsync(myinPython, ["render_myin.py", "os_myin", "render", "4"], { cwd: myinDir, env: { ...env, OUTNAME: "final_myin_v1_raw.mp4" } });
    await runAsync(myinPython, ["render_myin.py", "os_myin", "remix", "../../voice/os_myin/myin_video_final_myin_v1_raw.mp4", "final_myin_v1.mp4"], { cwd: myinDir, env });
    await runAsync(myinPython, ["render_myin.py", "os_myin", "handouts"], { cwd: myinDir, env });
    const video = path.join(videoDir, "final_myin_v1.mp4");
    // Per-frame lines go to the verbose log: a 12-minute video printed 1.2 MB of them and overflowed spawnSync's buffer before the summary.
    const report = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 }).stderr ?? "";
    const last = (pattern) => Number([...report.matchAll(pattern)].at(-1)?.[1]);
    const lufs = last(/\bI:\s+(-?\d+(?:\.\d+)?) LUFS/g), peak = last(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g);
    if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw Object.assign(new Error("loudness check did not run"), { code: "MYIN_LOUDNESS_UNKNOWN" });
    current.step = "upload";
    await upload(job.videoUploadUrl, video, "video/mp4");
    await upload(job.summaryUploadUrl, path.join(videoDir, "handouts", "한장정리.png"), "image/png");
    await upload(job.deckUploadUrl, path.join(videoDir, "handouts", "덱_전체.pdf"), "application/pdf");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
    const worked = await (shortsOnly?processShortform():processOne().then((rendered) => rendered || processMyinWords()).then((rendered) => rendered || processMyinPrep())
      .then((rendered) => rendered || processMyinClips()).then((rendered) => rendered || processMyinFinal()).then((rendered) => rendered || (current = { step: "voice" }, call(runId ? { runId } : {}, "worker")).then((step) => {
      if (step.processed) console.log(`voice step: ${JSON.stringify(step).slice(0, 300)}`);
      return step.processed;
    }).finally(() => { current = null; })).then(rendered=>rendered||processShortform()))
      .catch((error) => { console.error(error.message); return false; });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}
