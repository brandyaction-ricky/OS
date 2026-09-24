/**
 * Narrated-video media worker. Runs on the owner's Mac during development and in
 * Vercel Sandbox later; either way it holds only OS_URL and YOUTUBE_MEDIA_WORKER_SECRET.
 * The OS verifies every input; this process stitches audio, renders and uploads.
 *
 * OS_URL=https://<preview> YOUTUBE_MEDIA_WORKER_SECRET=... node tools/youtube-media-worker.mjs [--once]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const osUrl = (process.env.OS_URL ?? "").replace(/\/$/, "");
const secret = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";

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
  const job = await call({ action: "claim" });
  if (job.idle) return false;
  const dir = mkdtempSync(path.join(os.tmpdir(), "brandyaction-render-"));
  const lease = { renderId: job.renderId, lease: job.lease };
  try {
    const parts = [];
    for (const segment of job.segments) {
      const file = path.join(dir, `segment-${String(segment.index).padStart(3, "0")}.mp3`);
      await fetchTo(segment.url, file);
      parts.push(file);
    }
    writeFileSync(path.join(dir, "parts.txt"), parts.map((file) => `file '${file}'`).join("\n"));
    const narration = path.join(dir, "narration.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "parts.txt"), "-c", "copy", narration]);
    await upload(job.audioUploadUrl, narration, "audio/mpeg");
    const render = await call({ action: "brief", ...lease, segmentDurations: parts.map(seconds), durationSeconds: seconds(narration) });
    writeFileSync(path.join(dir, "brief.json"), JSON.stringify(render.brief));
    writeFileSync(path.join(dir, "catalog.json"), JSON.stringify(render.catalog));
    for (const [file, url] of Object.entries(render.characters)) await fetchTo(url, path.join(dir, path.basename(file)));
    const video = path.join(dir, "video.mp4");
    execFileSync(process.execPath, [path.join(here, "render-youtube-scene.mjs"), "--brief", path.join(dir, "brief.json"), "--audio", narration,
      "--catalog", path.join(dir, "catalog.json"), "--output", video], { stdio: "inherit" });
    await upload(render.videoUploadUrl, video, "video/mp4");
    const bytes = readFileSync(video);
    await call({ action: "complete", ...lease, videoBytes: bytes.length, videoSha256: createHash("sha256").update(bytes).digest("hex") });
    console.log(`render ready: ${job.renderId}`);
  } catch (error) {
    console.error(`render failed: ${job.renderId}: ${error.message}`);
    await call({ action: "fail", ...lease, code: String(error.code ?? "WORKER_RENDER_FAILED") }).catch(() => {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!osUrl.startsWith("https://") || secret.length < 32) throw new Error("OS_URL (https) and YOUTUBE_MEDIA_WORKER_SECRET are required");
  do {
    // No render ready? Advance the voice queue one step (review or one paragraph) so no separate scheduler is needed.
    const worked = await processOne().then((rendered) => rendered || call({}, "worker").then((step) => {
      if (step.processed) console.log(`voice step: ${JSON.stringify(step).slice(0, 300)}`);
      return step.processed;
    }))
      .catch((error) => { console.error(error.message); return false; });
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}
