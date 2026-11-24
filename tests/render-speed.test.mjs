import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");

test("전체 영상: drawing processes come from MYIN_RENDER_PROCS (default 4) and the unused burn-in encode is skipped", () => {
  assert.match(worker, /Math\.floor\(Number\(process\.env\.MYIN_RENDER_PROCS\)\) \|\| 4/);
  assert.equal(worker.match(/"render", renderProcs\(\)\], \{ cwd: myinDir, env: \{ \.\.\.drawEnv, OUTNAME: "final_myin_v1_raw\.mp4", MYIN_VIDEO_ONLY: "1" \} \}/g)?.length, 2);
  assert.doesNotMatch(worker, /"render", "4"/);
  for (const step of ["claimed", "drawn", "mixed", "uploaded"]) assert.match(worker, new RegExp(`stamp\\("${step}", job\\.runId\\)`));
});

test("음성 점검: audit beside read check → pause check; voice_fix joins voice.wav once a round when the package can", () => {
  assert.match(worker, /Promise\.all\(\[voiceAudit\(\), readCheck\(\)\.then\(async \(found\) => \[found, await pauseCheck\(\)\]\)\]\)/);
  assert.match(worker, /includes\("--assemble"\)/);
  assert.match(worker, /VOICE_FIX_DEFER: "1"/);
  assert.match(worker, /if \(deferred\) await runAsync\(speaker\.python, \["voice_fix\.py", voiceJob, "--assemble"\]/);
  const check = readFileSync(new URL("../tools/myin_read_check.py", import.meta.url), "utf8");
  assert.match(check, /pause_check_cache\.json/);
  assert.match(check, /\[round\(w\.start, 3\), round\(w\.end, 3\), w\.word\.strip\(\)\]/);   // pause_check_myin.py's own format
});
