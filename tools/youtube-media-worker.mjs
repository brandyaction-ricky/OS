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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
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

async function upload(url, file, contentType) {
  const response = await fetch(url, { method: "PUT", headers: { "content-type": contentType, "x-upsert": "true" }, body: readFileSync(file) });
  if (!response.ok) throw Object.assign(new Error(`upload ${response.status}`), { code: "WORKER_UPLOAD_FAILED" });
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
    await call({ action: "complete", ...lease, videoBytes: bytes.length, videoSha256: createHash("sha256").update(bytes).digest("hex") });
    console.log(`render ready: ${job.renderId}`);
  } catch (error) {
    console.error(`render failed: ${job.renderId}: ${error.message}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!osUrl.startsWith("https://") || secret.length < 32) throw new Error("OS_URL (https) and YOUTUBE_MEDIA_WORKER_SECRET are required");
  if (!existsSync(path.join(mindmapDir, "tools", "mindmap_pipeline", "stage_render.py"))) throw new Error("MINDMAP_DIR must point at Logan's unzipped mind-map package");
  void heartbeat();
  setInterval(() => void heartbeat(), 60_000).unref();
  do {
    // No render ready? Advance the voice queue one step (review or one paragraph) so no separate scheduler is needed.
    const worked = await processOne().then((rendered) => rendered || (current = { step: "voice" }, call(runId ? { runId } : {}, "worker")).then((step) => {
      if (step.processed) console.log(`voice step: ${JSON.stringify(step).slice(0, 300)}`);
      return step.processed;
    }).finally(() => { current = null; }))
      .catch((error) => { console.error(error.message); return false; });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}
