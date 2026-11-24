import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localVoiceBlocker, voiceFilter, VOICE_FALLBACK_MS } from "../lib/myin-local.ts";

// 음성도 내 컴퓨터에서 (로건 요청 11-16): a longform's voice on a member's own computer, only once that computer says it has the voice tools.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const online = { state: "online", ageSeconds: 10, engine: "same", job: null };

test("a render PC takes only voices no member took; a member's computer only its own", () => {
  const mine = { localVoice: { by: "a" } }, free = {};
  assert.equal(voiceFilter()(free), true);
  assert.equal(voiceFilter()(mine), false);
  assert.equal(voiceFilter("a")(mine), true);
  assert.equal(voiceFilter("b")(mine), false);
  assert.equal(voiceFilter("a")(free), false);
  assert.equal(VOICE_FALLBACK_MS, 5 * 60_000);
});

test("내 컴퓨터 makes a voice only when it is on, has the render PC's engine and the voice tools", () => {
  assert.equal(localVoiceBlocker({ ...online, voice: true }), null);
  assert.match(localVoiceBlocker({ ...online }), /음성 도구가 아직 없어요/);
  assert.match(localVoiceBlocker({ ...online, state: "offline", voice: true }), /꺼져 있어요/);
  assert.match(localVoiceBlocker({ ...online, engine: "different", voice: true }), /엔진/);
  assert.match(localVoiceBlocker(null), /연결하지 않았어요/);
});

test("the staff route hands out and takes back voices, and the worker claims them only with the voice tools", () => {
  const route = read("app/api/v1/content/youtube-automation/local-render/route.ts");
  assert.match(route, /input\.action === "myin_claim" \? await claimMyinWords\(undefined, false, undefined, actor\.ownerId\)/);
  assert.match(route, /\|\| input\.action === "myin_claim"\) await assertLocalEngine/);
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /voiceFilter\(owner\)\(run\), undefined, undefined, owner \? undefined : \{ name: pc \}/);
  assert.match(run, /record\.stage !== "words_pending" \|\| run\.words \|\| run\.layout/, "only a longform's first voice moves");
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /local && process\.env\.MYIN_LOCAL_VOICE === "on" && existsSync\(process\.env\.MYIN_VOICE_PYTHON/);
  assert.match(worker, /stage_voice\.py"\)\)\.includes\("FISH_TTS_URL"\)/, "only an engine whose voice script can ask Fish through the OS");
  assert.match(worker, /if \(!myinPkg \|\| \(local && !localVoice\(\)\)\) return false;/);
  assert.match(worker, /\.\.\.\(local \? \{ voice: localVoice\(\) \} : \{\}\)/);
});

test("키 없이 Fish: the staff computer sends its staff key to the OS relay, which calls Fish only for the voice it leased", () => {
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /local-render\/fish\?run=\$\{job\.runId\}&lease=\$\{job\.lease\}/);
  assert.match(worker, /const key = proxy \? secret : base\.FISH_API_KEY/);
  const relay = read("app/api/v1/content/youtube-automation/local-render/fish/route.ts");
  assert.match(relay, /requiredAgentScope: "records\.write"/);
  assert.match(relay, /input\.reference_id !== fish\.referenceId/);
  assert.doesNotMatch(relay, /FISH_API_KEY/, "the key is read only by the server function");
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /record\.stage !== "words_pending" \|\| run\.localVoice\?\.by !== ownerId/);
});

test("the staff installer adds the voice tools when the engine brings their package list, and runs without them otherwise", async () => {
  const { installVoice, workerEnv } = await import("../public/myin-local/myin-local.mjs");
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "myin-voice-"));
  assert.equal(installVoice(dir, dir), null, "no requirements-voice.lock: no voice tools, nothing installed");
  const env = workerEnv({ dir, python: "/py", voicePython: "/voice/py" }, dir, "bos_pat_x");
  assert.equal(env.MYIN_VOICE_PYTHON, "/voice/py");
  assert.equal(env.MYIN_LOCAL_VOICE, "on");
  assert.equal(workerEnv({ dir, python: "/py" }, dir, "bos_pat_x").MYIN_LOCAL_VOICE, undefined);
  assert.match(read("tools/myin-engine-pack.sh"), /MYIN_VOICE_PYTHON" -s -m pip freeze \| grep -v -E '\^-e \|@ file:\/\/' > "\$STAGE\/requirements-voice\.lock"/);
});
