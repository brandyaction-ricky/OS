import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 유쓰 요청 4/8 (2026-11-02): one video's own production record — what it used and made, and whether each file is still kept.
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the record is read from the run itself and only reads", async () => {
  const run = await read("lib/server/myin-run.ts");
  const record = run.slice(run.indexOf("export async function myinRecord"), run.indexOf("/** Short-lived addresses of the clips"));
  assert.match(record, /visibleRun\(actor, runId\)/, "only someone who can read the video");
  assert.doesNotMatch(record, /save\(|\.remove\(|\.upload\(|createSigned|process\.env/, "no change, no file handed out, no current default read");
  assert.match(record, /storage\.from\(bucket\)\.list\(/, "kept or 기록만 comes from what storage actually holds");
});

test("the 제작 panel shows it, and the route serves it", async () => {
  assert.match(await read("components/myin-v13-panel.tsx"), /<MyinRunRecord key=\{run\.id\}/);
  assert.match(await read("app/api/v1/content/youtube-automation/myin/route.ts"), /query\.get\("record"\)[\s\S]*myinRecord\(actor/);
  const panel = await read("components/myin-run-record.tsx");
  assert.match(panel, /기록만/);
  assert.doesNotMatch(panel, /method: "(POST|PATCH)"/);
});

test("the run screen keeps up with steps taken from another account", async () => {
  const panel = await read("components/myin-v13-panel.tsx");
  // A step waiting on a person (기획표 · 미리보기 확인) is read again every minute, a machine step every 20 seconds, a finished video never.
  assert.match(panel, /const pollEvery = working \? 20_000 : run && run\.stage !== "final_ready" \? 60_000 : 0;/);
  // A refused action (someone else already moved the step) reloads the run instead of leaving the old buttons.
  assert.match(panel, /finally \{ await load\(\); setBusy\(""\); \}/);
  assert.match(panel, /reason\.status === 409 \? `\$\{message\} 지금 상태로 화면을 새로 고쳤어요\.`/);
});

test("each drawn result keeps the engine it was drawn with", async () => {
  const run = await read("lib/server/myin-run.ts");
  // The engine is read when a ③/④ job is taken (the render PC's; a member's own computer must match it) and kept with its result.
  assert.match(run, /const drawnWith = \(run: MyinRun\) => run\.layout \? Promise\.resolve\(undefined\) : renderPcEngine\(\);/, "none for a 숏폼 (its vertical copy is not in the fingerprint)");
  assert.equal(run.match(/materialsKey, drawnWith,\s+owner \? undefined : \{ name: pc \}\);/g)?.length, 3, "preparation, clips and the full video");
  assert.match(run, /const engine = await engineOf\?\.\(run\);/);
  assert.equal(run.match(/\.\.\.drewWith\(run\)/g)?.length, 4, "preparation, clips, scene pictures and the full video");
  assert.match(await read("components/myin-run-record.tsx"), /<dt>엔진 버전<\/dt><dd>\{engineLine\(record\)\}<\/dd>/);
});

test("an earlier video's 채널 모양 only fills a new video's start", async () => {
  const run = await read("lib/server/myin-run.ts");
  const earlier = run.slice(run.indexOf("export async function myinEarlierStyles"), run.indexOf("/** Short-lived addresses of the clips"));
  assert.match(earlier, /actor\.supabase\.from\("os_records"\)/, "only videos this member can read");
  assert.match(earlier, /\.neq\("parent_id", sourceId\)/, "not the video being started");
  assert.doesNotMatch(earlier, /save\(|\.insert\(|\.update\(|\.upload\(|createService/, "reading changes nothing");
  assert.match(await read("app/api/v1/content/youtube-automation/myin/route.ts"), /query\.get\("earlierStyles"\)[\s\S]*myinEarlierStyles\(actor/);
  const panel = await read("components/myin-v13-panel.tsx");
  assert.match(panel, /<EarlierStylePick sourceId=\{sourceId\} token=\{accessToken\} styles=\{styles\} onPick=\{setStyleId\} \/>/, "it sets the start's choice");
  const pick = (await read("components/myin-run-record.tsx")).split("export function EarlierStylePick")[1];
  assert.doesNotMatch(pick, /method: "(POST|PATCH)"/);
});
