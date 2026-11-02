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
