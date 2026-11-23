import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../components/meeting-recorder.tsx", import.meta.url), "utf8");
const pick = /export const looksInvented=[^\n]*/.exec(source)[0].replace("export ", "").replace(/\(text:string\)/, "(text)");
const looksInvented = new Function(`${ts.transpile(pick)}; return looksInvented;`)();

test("a speech-to-text guess with no Korean in it never reaches the notes", () => {
  assert.equal(looksInvented("Дякую!"), true);
  assert.equal(looksInvented("Thank you."), true);
  assert.equal(looksInvented("네, 다음 안건으로 갈게요."), false);
  assert.equal(looksInvented("CTR 4.7%"), true);
  assert.equal(looksInvented("We reviewed the campaign numbers and agreed to move the launch to Friday."), false);
});

test("the recorder keeps the screen on, rotates by the clock, and skips silent segments", async () => {
  assert.match(source, /navigator\.wakeLock\?\.request\("screen"\)/);
  assert.match(source, /Date\.now\(\)-began>=SEGMENT_MS\)\)rotate\(\)/);
  assert.match(source, /if\(checking&&!ears\.sound\)\{setSegments/);
  assert.match(source, /if\(looksInvented\(result\.transcript\)\)\{mark\(segment\.no,"silent"\);return;\}/);
  assert.match(source, /30초째 소리가 안 들려요/);
  assert.match(source, /track\.onmute=\(\)=>setPaused\(true\)/);
});

test("회의로 가기 opens a running meeting without a second recording prompt; a meeting with no notes can still end", async () => {
  const prep = await readFile(new URL("../components/team/prep-actions.tsx", import.meta.url), "utf8");
  assert.equal(prep.match(/if \(running\) \{ router\.push\(meetingHref\(running\.id\)\); return; \}/g)?.length, 2);
  const screen = await readFile(new URL("../components/team/meeting-actions.tsx", import.meta.url), "utf8");
  assert.match(screen, /정리 없이 회의 끝내기/);
});
