import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../components/content-pipeline-panel.tsx", import.meta.url), "utf8");
const automation = readFileSync(new URL("../components/content-automation-workspace.tsx", import.meta.url), "utf8");

test("shortform factory v2 keeps two lines, lineage, assets and 22 gated steps", () => {
  assert.match(panel, /A · 롱폼에서 숏폼/);
  assert.match(panel, /B · 숏폼 직접 제작/);
  for (const field of ["packageId", "rulesVersion", "voiceUrl", "imageFolderUrl", "characterUrl", "editSpecUrl", "finalVideoUrl"]) assert.match(panel, new RegExp(field));
  const stepCount = [...panel.matchAll(/steps: \[([^\]]+)\]/g)].reduce((count, match) => count + (match[1].match(/"/g)?.length ?? 0) / 2, 0);
  assert.equal(stepCount, 22);
  assert.match(panel, /PIPELINE_GATES\.map/);
  assert.match(automation, /factoryVersion: 2/);
});
