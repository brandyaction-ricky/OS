import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../components/content-radar-workspace.tsx", import.meta.url), "utf8");

test("confirmed niche topics move into a separate planning queue immediately", () => {
  assert.match(source, /"planning", label: "기획", hint: "확정 주제"/);
  assert.match(source, /nicheQueue\.filter\(\(topic\) => topic\.status !== "planned"\)/);
  assert.match(source, /nicheQueue\.filter\(\(topic\) => topic\.status === "planned"\)/);
  assert.match(source, /setRecords\(\(current\) => current\.map/);
  assert.match(source, /setTab\("planning"\)/);
  assert.match(source, /기획 전달 완료/);
  assert.match(source, /틈새로 되돌리기/);
});
