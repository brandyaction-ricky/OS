import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");

test("전체 영상: drawing processes come from MYIN_RENDER_PROCS (default 4) and the unused burn-in encode is skipped", () => {
  assert.match(worker, /Math\.floor\(Number\(process\.env\.MYIN_RENDER_PROCS\)\) \|\| 4/);
  assert.equal(worker.match(/"render", renderProcs\(\)\], \{ cwd: myinDir, env: \{ \.\.\.drawEnv, OUTNAME: "final_myin_v1_raw\.mp4", MYIN_VIDEO_ONLY: "1"/g)?.length, 2);
  assert.doesNotMatch(worker, /"render", "4"/);
  for (const step of ["claimed", "drawn", "mixed", "uploaded"]) assert.match(worker, new RegExp(`stamp\\("${step}", job\\.runId\\)`));
});

test("음성 점검: audit beside read check → pause check; voice_fix joins voice.wav once a round when the package can", () => {
  assert.match(worker, /Promise\.all\(\[voiceAudit\(\), readCheck\(\)\.then\(async \(found\) => \[found, await pauseCheck\(\)\]\)\]\)/);
  assert.match(worker, /includes\("--assemble"\)/);
  assert.match(worker, /VOICE_FIX_DEFER: "1"/);
  assert.match(worker, /if \(deferred \|\| patch\) await runAsync\(speaker\.python, \["voice_fix\.py", voiceJob, "--assemble"\]/);
  const check = readFileSync(new URL("../tools/myin_read_check.py", import.meta.url), "utf8");
  assert.match(check, /pause_check_cache\.json/);
  assert.match(check, /\[round\(w\.start, 3\), round\(w\.end, 3\), w\.word\.strip\(\)\]/);   // pause_check_myin.py's own format
});

test("낭독 D: every new longform run keeps voiceTempo 1.1; the render PC passes 1.1× and 0.27 s gaps, keeps an existing voice's pace, reuses only same-pace voices, voices CTA lines at the run's pace", async () => {
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /voiceTempo: z\.literal\("1\.1"\)\.optional\(\)/);
  assert.match(run, /longformRun\(\{ layout: input\.layout, renderer: input\.renderer, recycle: recycled\?\.recycle \}\) \? \{ voiceTempo: LONGFORM_TEMPO \}/);
  assert.match(run, /\.\.\.\(tempo !== "1" \? \{ voiceTempo: tempo, pulling: true \} : \{\}\)/);
  assert.match(run, /return same\.filter\(\(_, i\) => paces\[i\] === tempo\)/);
  assert.match(run, /await voiceDonors\(service, sourceId, run, LONGFORM_TEMPO\)/);
  assert.match(worker, /job\.voiceTempo === D_TEMPO \|\| job\.pulling \? D_TEMPO : "1"/);
  assert.match(worker, /Object\.assign\(speaker\.env, \{ VOICE_TEMPO: tempo, VOICE_PARA_GAP: D_PARA_GAP \}\)/);
  assert.equal(worker.match(/ctaAtVoicePace\(myinVoiceEnv\(/g)?.length, 2);
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { voiceDonor } = await import("../tools/youtube-media-worker.mjs");
  const root = mkdtempSync(path.join(tmpdir(), "tempo-"));
  const donor = (name, tempo) => { const dir = path.join(root, name, "voice", "os_voice"); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, "speech.txt"), "x"); if (tempo) writeFileSync(path.join(dir, "voice_tempo.txt"), tempo); return path.join(root, name); };
  const old = donor("old"), fast = donor("fast", "1.1");
  assert.equal(voiceDonor([old, fast], "1.1"), fast);
  assert.equal(voiceDonor([fast, old], "1"), old);
  assert.equal(voiceDonor([old], "1.1"), undefined);
});

test("나눠 그리기: MYIN_HELPERS lists host:procs; the worker hands pieces out before its own render and then fills only what is missing", async () => {
  const { parseHelpers, pieceFile } = await import("../tools/myin-split.mjs");
  assert.deepEqual(parseHelpers("Basic@100.1.2.3:6, render-mbp1 ,local:2"), [{ host: "Basic@100.1.2.3", procs: 6 }, { host: "render-mbp1", procs: 4 }, { host: "local", procs: 2 }]);
  assert.deepEqual(parseHelpers(""), []);
  assert.equal(pieceFile("/w/chunks", 7), "/w/chunks/c07.mp4");
  assert.equal(pieceFile("/w/chunks", 104), "/w/chunks/c104.mp4");   // the engine's f"c{i:02d}.mp4"
  assert.match(worker, /splitPieces\(\{ runId: job\.runId, work, myinDir, env: drawEnv, python: myinPython, procs: Number\(renderProcs\(\)\), helpers: parseHelpers\(process\.env\.MYIN_HELPERS\) \}\)/);
  assert.match(worker, /\.\.\.\(split\.used \? \{ MYIN_REUSE_PIECES: "1" \} : \{\}\)/);
  assert.match(worker, /"myin_help_pieces\.sh"\), helper\)/);
  const script = readFileSync(new URL("../tools/myin_help_pieces.sh", import.meta.url), "utf8");
  assert.match(script, /render_myin\.py os_myin pieces \$procs <&3 &/);
  assert.match(script, /own work started: stop helping/);
});
