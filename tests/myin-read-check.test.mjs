import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("발음 확인: a word both transcriptions heard differently is a misreading; one model alone, or notation, is not", { skip: spawnSync("python3", ["-V"]).status !== 0 }, () => {
  assert.equal(execFileSync("python3", [fileURLToPath(new URL("../tools/myin_read_check.py", import.meta.url)), "test"], { encoding: "utf8" }).trim(), "ok");
});

test("the render PC hears its own voice twice after the audit and sends the misreads in the words bundle", () => {
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /speaker\.onPc && !job\.recycle && process\.env\.MYIN_READ_CHECK !== "off"/);
  assert.match(worker, /runOut\(myinPython, \[readCheckScript, voiceDir, file\]\)/);
  assert.match(worker, /\.\.\.\(Array\.isArray\(misreads\) \? \{ misreads \} : \{\}\)/);
});

test("음성 확인 lists the misreads with a play button and a memo that names what was heard", () => {
  assert.match(read("lib/server/myin-run.ts"), /misreads: misreads\.success \? misreads\.data\.slice\(0, 40\)/);
  const screen = read("components/myin-voice-check.tsx");
  assert.match(screen, /잘못 읽은 것 같은 곳 \{data\.misreads\.length\}곳/);
  assert.match(screen, /setText\(`「\$\{row\.said\}」가 「\$\{row\.medium \|\| row\.small\}」로 들림`/);
});
