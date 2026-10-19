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
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    writeFileSync(path.join(videoDir, "myin_storyboard.json"), JSON.stringify(job.storyboard, null, 1));
    for (const asset of job.assets) {
      mkdirSync(path.join(work, "assets", asset.kind), { recursive: true });
      await fetchTo(asset.url, path.join(work, "assets", asset.kind, asset.file));
    }
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
    const misses = log.split("\n").filter((line) => line.includes("못 찾음"));
    const sheets = readdirSync(videoDir).filter((name) => /^preview_\d+\.png$/.test(name)).sort().slice(0, job.sheetUploadUrls.length);
    current.step = "upload";
    for (const [i, name] of sheets.entries()) await upload(job.sheetUploadUrls[i], path.join(videoDir, name), "image/png");
    const bundle = path.join(videoDir, "myin-prep.json");
    writeFileSync(bundle, JSON.stringify({ misses, sheets: sheets.length, log: log.slice(-20_000) }));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!osUrl.startsWith("https://") || secret.length < 32) throw new Error("OS_URL (https) and YOUTUBE_MEDIA_WORKER_SECRET are required");
  if (!existsSync(path.join(mindmapDir, "tools", "mindmap_pipeline", "stage_render.py"))) throw new Error("MINDMAP_DIR must point at Logan's unzipped mind-map package");
  void heartbeat();
  setInterval(() => void heartbeat(), 60_000).unref();
  do {
    // No render ready? Advance the voice queue one step (review or one paragraph) so no separate scheduler is needed.
    const worked = await processOne().then((rendered) => rendered || processMyinWords()).then((rendered) => rendered || processMyinPrep()).then((rendered) => rendered || (current = { step: "voice" }, call(runId ? { runId } : {}, "worker")).then((step) => {
      if (step.processed) console.log(`voice step: ${JSON.stringify(step).slice(0, 300)}`);
      return step.processed;
    }).finally(() => { current = null; }))
      .catch((error) => { console.error(error.message); return false; });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}
