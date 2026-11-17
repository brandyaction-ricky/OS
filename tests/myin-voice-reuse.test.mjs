import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// 2026-11-16: one changed line re-voiced the whole script (about an hour, every paragraph paid).
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function runFolder(root, id, paragraphs, readings = {}) {
  const work = path.join(root, id), voice = path.join(work, "voice", "os_voice"), timing = path.join(work, "tools", "voice_timing");
  mkdirSync(voice, { recursive: true }); mkdirSync(timing, { recursive: true });
  writeFileSync(path.join(timing, "읽기사전.json"), JSON.stringify({ _설명: "note", ...readings }));
  if (!paragraphs) return work;
  writeFileSync(path.join(voice, "speech.txt"), ["#SECTION 도입", ...paragraphs].join("\n"));
  paragraphs.forEach((text, n) => {
    const p = `p${String(n).padStart(2, "0")}`;
    writeFileSync(path.join(voice, `${p}_t.wav`), `voice of ${text}`);
    writeFileSync(path.join(voice, `${p}_s00_2_t.wav`), `take of ${text}`);
    writeFileSync(path.join(voice, `${p}_문장.json`), JSON.stringify([{ j: 0, text, take: `${p}_s00_2_t.wav` }]));
    writeFileSync(path.join(voice, `${p}_list.txt`), `file '${voice}/${p}_s00_2_t.wav'\n`);
  });
  writeFileSync(path.join(voice, "고친문장.json"), JSON.stringify({ p01_s00: { from_take: 4, memo: "다시" } }));
  return work;
}

test("unchanged paragraphs come from the earlier voice under their new numbers; changed ones are left to make", async () => {
  const { reuseEarlierVoice, REUSE_MARK } = await import(`../tools/youtube-media-worker.mjs?reuse=${Date.now()}`);
  const root = mkdtempSync(path.join(os.tmpdir(), "voice-reuse-"));
  try {
    const donor = runFolder(root, "11111111-1111-1111-1111-111111111111", ["첫 문단.", "둘째 문단.", "셋째 문단 2009년."]);
    // A line was added at the top, the second paragraph was edited, and a reading for 2009년 was added since.
    const work = runFolder(root, "22222222-2222-2222-2222-222222222222", null, { "2009년": "이천구년" });
    const texts = ["새로 넣은 문단.", "첫 문단.", "둘째 문단 고침.", "셋째 문단 2009년."];
    const missing = path.join(root, "33333333-3333-3333-3333-333333333333");
    assert.equal(reuseEarlierVoice(work, texts, [missing, donor]), 1);
    const voice = path.join(work, "voice", "os_voice");
    assert.equal(readFileSync(path.join(voice, "p01_t.wav"), "utf8"), "voice of 첫 문단.");
    assert.equal(readFileSync(path.join(voice, `p01${REUSE_MARK}`), "utf8"), "첫 문단.");
    assert.deepEqual(JSON.parse(readFileSync(path.join(voice, "p01_문장.json"), "utf8"))[0].take, "p01_s00_2_t.wav");
    assert.equal(readFileSync(path.join(voice, "p01_list.txt"), "utf8"), `file '${voice}/p01_s00_2_t.wav'\n`);
    for (const p of ["p00", "p02", "p03"]) assert.equal(existsSync(path.join(voice, `${p}_t.wav`)), false, p);
    // The earlier voice's fixes were for its p00 (now p01), not its p01: none carried, so nothing points at the wrong sentence.
    assert.equal(existsSync(path.join(voice, "고친문장.json")), false);
    assert.equal(reuseEarlierVoice(work, texts, [missing]), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the OS names earlier voices of the same video and voice, and the cost asks only for the changed paragraphs", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /async function voiceDonors[\s\S]{0,700}m\.voiceOn && m\.words && m\.voiceModel === like\.voiceModel[\s\S]{0,120}m\.voiceReferenceFingerprint === like\.voiceReferenceFingerprint/);
  assert.match(run, /const earlier = run\.voiceOn && !run\.words && !run\.voiceFixes\?\.length \? \(await voiceDonors\(service, run\.sourceId, run, record\.created_at\)/);
  assert.match(run, /\.\.\.\(changed \? \{ voiceReuse: await voiceReuse\(/);
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /const reuse = run\?\.scriptChanged \? run\.voiceReuse : null;/);
  assert.match(panel, /바뀐 문단 \$\{reuse\.make\}개만 새로 만들어요/);
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /reuseEarlierVoice\(work, job\.paragraphs\.map\(\(p\) => p\.text\), earlier\)/);
  assert.match(worker, /finally \{ for \(const name of readdirSync\(voiceDir\)\) if \(name\.endsWith\(REUSE_MARK\)\) rmSync/);
});
