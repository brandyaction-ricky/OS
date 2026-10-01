import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../components/content-radar-workspace.tsx", import.meta.url), "utf8");

test("content topics retain research evidence, decisions and script handoff in one workspace", () => {
  assert.match(workspace, /name="youtubeSources"/);
  assert.match(workspace, /name="instagramSources"/);
  assert.match(workspace, /name="analystNotes"/);
  assert.match(workspace, /name="brandContext"/);
  assert.match(workspace, /name="topicFit"/);
  assert.match(workspace, /name="audienceFit"/);
  assert.match(workspace, /name="queryIntentFit"/);
  assert.match(workspace, /name="limitations"/);
  assert.match(workspace, /status: "review" \| "blocked"/);
  assert.match(workspace, /decideTopic\("planned"\)/);
  assert.match(workspace, /\/content\/scripts\?sourceId=/);
});
