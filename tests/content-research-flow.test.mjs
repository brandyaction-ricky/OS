import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../components/content-radar-workspace.tsx", import.meta.url), "utf8");

test("content topics retain research evidence and hand off to packaging before scripts", () => {
  assert.match(workspace, /name="researchSources"/);
  assert.match(workspace, /name="analystNotes"/);
  assert.match(workspace, /name="brandContext"/);
  assert.match(workspace, /status: "review" \| "blocked"/);
  assert.match(workspace, /decideTopic\("planned"\)/);
  assert.match(workspace, /\/content\/packages\?sourceId=/);
});
