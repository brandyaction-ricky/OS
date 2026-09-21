import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planningHandoffSchema, readPlanningHandoff, planningHandoffUpdate, handoffFields } from "../lib/content-planning-handoff.ts";

const input = () => ({ schemaVersion: 1, productionFormat: "undecided", contentApproach: "undecided", ...Object.fromEntries(handoffFields.map(([key]) => [key, ""])) });
test("empty handoff keeps unknowns, never supplies an approval", () => {
  assert.deepEqual(readPlanningHandoff(input()), input());
  for (const value of [null, undefined, {}, "script", { ...input(), schemaVersion: 2 }, { ...input(), approved: true }]) assert.equal(readPlanningHandoff(value), null);
});
for (const productionFormat of ["script", "board", "mixed"]) test(`format ${productionFormat} is independent of information approach`, () => {
  const data = { ...input(), productionFormat, contentApproach: "information" };
  assert.deepEqual(readPlanningHandoff(data), data);
});
test("saving preserves existing metadata and uses optimistic concurrency without changing stage/status", () => {
  const source = { id: "synthetic-topic", version: 7, metadata: { researchBrief: { analystNotes: "synthetic" }, pickedCandidate: { title: "synthetic" }, pipelineReviews: [] } };
  const before = structuredClone(source);
  const update = planningHandoffUpdate(source, { ...input(), titlePromise: "  synthetic promise  " });
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(update).sort(), ["expectedVersion", "id", "metadata"]);
  assert.equal(update.expectedVersion, 7);
  assert.deepEqual(update.metadata.researchBrief, source.metadata.researchBrief);
  assert.deepEqual(update.metadata.pickedCandidate, source.metadata.pickedCandidate);
  assert.deepEqual(update.metadata.pipelineReviews, []);
  assert.equal(update.metadata.planningHandoff.titlePromise, "synthetic promise");
});
test("reject oversized, invalid enums, missing fields and forged completion", () => {
  for (const [key, , limit] of handoffFields) assert.equal(planningHandoffSchema.safeParse({ ...input(), [key]: "x".repeat(limit + 1) }).success, false);
  for (const change of [{ productionFormat: "information" }, { contentApproach: "board" }, { thumbnailCopy: undefined }, { executionAllowed: true }]) assert.throws(() => planningHandoffUpdate({ id: "test", version: 1, metadata: {} }, { ...input(), ...change }));
});
test("planning and script surfaces use DEV gate; saved memo is not fed to generation", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const page = read("../app/(os)/[stage]/[page]/page.tsx");
  const radar = read("../components/content-radar-workspace.tsx");
  const scripts = read("../components/content-pipeline-workspaces.tsx");
  const panel = read("../components/content-planning-handoff.tsx");
  assert.match(page, /ContentScriptsWorkspace showPlanningHandoff=\{canUseSystemOnePreflight\(process.env\)\}/);
  assert.match(radar, /showReferenceCheck \? <ContentPlanningHandoff/);
  assert.match(scripts, /showPlanningHandoff \? <LinkedPlanningHandoff/);
  assert.match(panel, /source.id !== sourceId/);
  assert.match(panel, /return \(\) => \{ active = false; \}/);
  assert.match(panel, /expectedVersion|planningHandoffUpdate/);
  assert.match(panel, /칠판형은/);
  assert.match(panel, /AI 원고 생성에 자동 전달되지/);
  assert.doesNotMatch(panel, /generateContent|createDocument|dangerouslySetInnerHTML|method: "POST"/);
});
