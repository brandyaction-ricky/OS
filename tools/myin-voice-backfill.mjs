// 지난 영상 음성 올리기 (owner request 2026-10-28): runs whose stage 1 ran before the render PC kept its processed voice.wav in the OS
// get it once from this PC's work folders, so 「음성 내려받기」 (and 내 컴퓨터) work for them too. Once; new runs upload it in stage 1.
// Run on the render PC, from the live release, with the worker's settings (nothing is printed but run ids and sizes):
//   set -a; source ~/render/worker.prod.env; set +a; node tools/myin-voice-backfill.mjs
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadVoiceParts } from "./youtube-media-worker.mjs";

const osUrl = (process.env.OS_URL ?? "").replace(/\/$/, ""), secret = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
const work = process.env.MYIN_WORK || path.join(os.homedir(), "myin", "work");
const call = async (body) => {
  const response = await fetch(`${osUrl}/api/v1/content/youtube-automation/media`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message ?? `OS ${response.status}`);
  return json;
};

const { runs } = await call({ action: "myin_voice_backfill" });
console.log(`음성이 OS에 없는 영상 ${runs.length}편`);
for (const runId of runs) {
  const file = path.join(work, runId, "voice", "os_voice", "voice.wav");
  if (!existsSync(file)) { console.log(`${runId}: 이 PC에 voice.wav 없음 — 건너뜀`); continue; }
  const { uploadUrls } = await call({ action: "myin_voice_backfill", runId });
  if (!uploadUrls.length) { console.log(`${runId}: 이미 있음`); continue; }
  const voice = await uploadVoiceParts(file, uploadUrls);
  if (!voice) continue;
  const { saved } = await call({ action: "myin_voice_backfill_complete", runId, ...voice });
  console.log(`${runId}: ${saved ? "올림" : "이미 있음"} (${voice.parts}조각, ${(voice.bytes / 1e6).toFixed(0)}MB)`);
}
