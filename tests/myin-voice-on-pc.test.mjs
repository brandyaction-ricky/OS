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
  assert.deepEqual([joined.env.FISH_API_KEY, joined.env.FISH_VOICE_ID], ["unused", "unused"]);  // 구독 멘트 (2026-10-29 로건 stage_cta): the ④ CTA lines come without files and are voiced the same way, on top of the render env.
  const cta = worker.myinVoiceEnv({ paragraphs: [], fishVoice: { referenceId: "voice-2" } }, { PATH: "/usr/bin", FISH_API_KEY: "k", STORY: "myin_storyboard.json" });
  assert.deepEqual([cta.onPc, cta.env.FISH_VOICE_ID, cta.env.STORY], [true, "voice-2", "myin_storyboard.json"]);
});

// 음성 확인·수정 (로건 OS 요청 2026-10-30): voice_fix's new dictionary lines go back into the package; lines already there win.
test("mergeVoiceDictionaries adds only new readings and new break tests to the package", async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const worker = await import(`../tools/youtube-media-worker.mjs?merge-${Date.now()}`);
  const from = mkdtempSync(join(tmpdir(), "dict-from-")), to = mkdtempSync(join(tmpdir(), "dict-to-"));
  writeFileSync(join(to, "읽기사전.json"), JSON.stringify({ _설명: "x", GPT: "지피티" }));
  writeFileSync(join(to, "어색문장모음.json"), JSON.stringify({ _설명: "y", items: [{ id: "a", text: "원래" }] }));
  writeFileSync(join(from, "읽기사전.json"), JSON.stringify({ _설명: "x", GPT: "바뀐 값", AI: "에이아이" }));
  writeFileSync(join(from, "어색문장모음.json"), JSON.stringify({ _설명: "y", items: [{ id: "a", text: "바뀜" }, { id: "b", text: "새 문장" }] }));
  assert.deepEqual(worker.mergeVoiceDictionaries(from, to), { readings: 1, tests: 1 });
  assert.deepEqual(JSON.parse(readFileSync(join(to, "읽기사전.json"), "utf8")), { _설명: "x", GPT: "지피티", AI: "에이아이" });
  assert.deepEqual(JSON.parse(readFileSync(join(to, "어색문장모음.json"), "utf8")).items.map((item) => item.text), ["원래", "새 문장"]);
  assert.deepEqual(worker.mergeVoiceDictionaries(from, to), { readings: 0, tests: 0 }, "a second run adds nothing");
  assert.equal(worker.fixReport("W1030 ... Redirects are currently not supported\nLoading weights: 100%\n찾은 문장: 문단 1 · 문장 1 — 대신 듣고 보면서 알 수 있어요.\n목소리 업데이트: …/voice.wav"),
    "찾은 문장: 문단 1 · 문장 1 — 대신 듣고 보면서 알 수 있어요.\n목소리 업데이트: …/voice.wav");
});
