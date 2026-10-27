import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The render PC asks Logan's tools/voice_timing for the Fish copy and sends back only where commas were added.
test("myinBreaths returns the word positions the package's breath model put a comma after", { skip: spawnSync("python3", ["-V"]).status !== 0 }, async () => {
  const pkg = mkdtempSync(path.join(os.tmpdir(), "myin-breath-"));
  mkdirSync(path.join(pkg, "tools", "voice_timing"), { recursive: true });
  writeFileSync(path.join(pkg, "tools", "voice_timing", "voice_timing.py"),
    "def prepare_text(t):\n    w = t.split()\n    return ' '.join(x + (',' if i == 1 else '') for i, x in enumerate(w))\n");
  Object.assign(process.env, { MYIN_PKG: pkg, MYIN_PYTHON: "python3" });
  const worker = await import(`../tools/youtube-media-worker.mjs?breath=${Date.now()}`);
  const paragraphs = [{ index: 0, text: "그래서 저는 오늘 이 얘기를 해볼게요." }, { index: 3, text: "짧게." }];
  assert.deepEqual(worker.myinBreaths(paragraphs), [{ index: 0, after: [1] }, { index: 3, after: [] }]);
  process.env.VOICE_TIMING = "off";
  assert.deepEqual(worker.myinBreaths(paragraphs), [{ index: 0, after: [] }, { index: 3, after: [] }]);
  delete process.env.VOICE_TIMING;
});
