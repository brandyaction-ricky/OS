import assert from "node:assert/strict";
import test from "node:test";

// 로건 사람 말투 음성 (2026-10-29, A안): a run with no voice files is voiced on the render PC with its own Fish key and the OS's voice.
test("myinVoiceEnv voices on the render PC when the OS sends no files, and keeps the older join-only path working", async () => {
  process.env.MYIN_PKG = process.env.MYIN_PKG || "/tmp/none";
  const worker = await import(`../tools/youtube-media-worker.mjs?voice=${Date.now()}`);
  const onPc = { paragraphs: [{ index: 0, text: "가" }], fishVoice: { referenceId: "voice-2" } };
  const made = worker.myinVoiceEnv(onPc, { PATH: "/usr/bin", FISH_API_KEY: "k", MYIN_VOICE_PYTHON: "/v/python" });
  assert.equal(made.onPc, true);
  assert.equal(made.python, "/v/python");
  assert.equal(made.env.FISH_API_KEY, "k");
  assert.equal(made.env.FISH_VOICE_ID, "voice-2");
  assert.throws(() => worker.myinVoiceEnv(onPc, { PATH: "/usr/bin" }), (error) => error.code === "MYIN_VOICE_KEY_MISSING");
  const older = { paragraphs: [{ index: 0, text: "가", url: "https://x/p00.wav" }] };
  const joined = worker.myinVoiceEnv(older, { PATH: "/usr/bin" });
  assert.equal(joined.onPc, false);
  assert.deepEqual([joined.env.FISH_API_KEY, joined.env.FISH_VOICE_ID], ["unused", "unused"]);
});
