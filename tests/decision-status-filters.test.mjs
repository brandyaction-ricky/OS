import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../lib/workspace-config.ts", import.meta.url), "utf8");
const operations = readFileSync(new URL("../components/operations-workspace.tsx", import.meta.url), "utf8");

test("decision filters include the statuses stored by existing records", () => {
  const decisionLine = config.split("\n").find((line) => line.includes('"/home/decisions"')) ?? "";
  assert.match(decisionLine, /flow\("open", "review", "decided", "completed", "superseded", "cancelled"\)/);
  assert.match(config, /completed: "완료"/);
  assert.match(config, /superseded: "대체됨"/);
  assert.match(operations, /\["done", "completed", "published"/);
});
