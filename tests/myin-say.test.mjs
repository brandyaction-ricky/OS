import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 문장 테이크 (영상 편집기 · 로건 개발 문서 v3 7.2-1): the render PC reads a sentence again in the video's voice, k takes with their endings.
const python = ["python3", "python"].find((name) => spawnSync(name, ["--version"]).status === 0);
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("myin_say.py makes k takes with his generation, EQ and reading dictionary, and prints their lengths", { skip: (!python || !ffmpeg) && "needs python and ffmpeg" }, () => {
  const tools = mkdtempSync(path.join(os.tmpdir(), "say-tools-")), out = path.join(tools, "out");
  mkdirSync(path.join(tools, "mindmap_pipeline")); mkdirSync(path.join(tools, "voice_timing"));
  // Stand-ins for his stage_voice / voice_timing: the same names the narration uses; _gen writes a 1.2 s tone like a tightened take.
  writeFileSync(path.join(tools, "mindmap_pipeline", "stage_voice.py"), [
    "import subprocess, json, os", "VOICE_EQ = 'highpass=f=70'", "def load_env(): return {'FISH_API_KEY': 'x'}",
    "def _gen(text, base, env):", "    open(base + '.txt', 'w', encoding='utf-8').write(text)",
    "    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','sine=frequency=200:duration=1.2', base + '_t.wav'], check=True)", "    return base + '_t.wav'"].join("\n"));
  writeFileSync(path.join(tools, "voice_timing", "voice_timing.py"), "def prepare_text(t): return t + ' [prep]'\ndef read_aloud(t): return t.replace('ChatGPT', '챗지피티')\n");
  const run = spawnSync(python, ["-I", "tools/myin_say.py", tools, out, "2", "ChatGPT로 정리해요."], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim().split("\n").at(-1));
  assert.deepEqual(result.takes.map((t) => t.k), [0, 1]);
  assert.ok(result.takes.every((t) => Math.abs(t.seconds - 1.2) < 0.05), JSON.stringify(result));
  assert.ok(existsSync(path.join(out, "t0.wav")) && existsSync(path.join(out, "t1.wav")));
  assert.equal(readFileSync(path.join(out, "raw0.txt"), "utf8"), "챗지피티로 정리해요. [prep]", "the reading dictionary and the TTS copy, as the narration");
});

test("the OS hands takes only to the render PC, for a longform voiced there, and nothing in the video changes", () => {
  const say = readFileSync(new URL("../lib/server/myin-say.ts", import.meta.url), "utf8");
  assert.match(say, /await myinSayTarget\(service, project\.id\)/);
  assert.match(say, /sentences: z\.array\(z\.string\(\)\.trim\(\)\.min\(1\)\.max\(300\)\)\.min\(1\)\.max\(5\), takes: z\.number\(\)\.int\(\)\.min\(1\)\.max\(3\)/, "at most 5 sentences × 3 takes");
  assert.doesNotMatch(say, /myin_v13|retireFinal|\.from\("os_records"\)\.update\(\{ metadata: run/, "the video's own run is never written");
  assert.doesNotMatch(say, /best|sort\(\(a, b\) => \(a\.rise/, "no take is ranked by its end height (대표 2026-11-04: a person listens and picks)");
  const run = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /if \(!voiceFixable\(latest\.record, latest\.run\)\) throw new ApiError\(409, "MYIN_SAY_UNAVAILABLE"/);
  const media = readFileSync(new URL("../app/api/v1/content/youtube-automation/media/route.ts", import.meta.url), "utf8");
  for (const action of ["myin_say_claim", "myin_say_complete", "myin_say_fail"]) assert.match(media, new RegExp(`"${action}"`));
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /export async function processMyinSay\(\) \{\n  if \(!myinPkg \|\| local\) return false;/, "never on a member's computer (no Fish key there)");
  assert.match(worker, /rendered \|\| processMyinSay\(\)\)\.then\(\(rendered\) => rendered \|\| processMyinCta\(\)\)/);
  const editor = readFileSync(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  assert.match(editor, /action === "say"\) return NextResponse\.json\(await requestSay/);
});
