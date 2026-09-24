import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planningHandoffSchema, readPlanningHandoff, planningHandoffUpdate, handoffFields, readProductionFormatChange } from "../lib/content-planning-handoff.ts";

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
  assert.match(page, /canUseSystemOnePreflight\(process.env\) \|\| canUseSystemOneJevShadow\(process.env\)/);
  assert.match(page, /ContentScriptsWorkspace showPlanningHandoff=\{systemOneContentEnabled\} showContentEvidence=\{contentEvidenceEnabled\}/);
  assert.match(radar, /showReferenceCheck \? <ContentPlanningHandoff/);
  assert.match(scripts, /showPlanningHandoff \|\| showContentEvidence \? <LinkedPlanningHandoff evidenceOnly=\{!showPlanningHandoff\} showEvidence=\{showContentEvidence\} showProductionDocuments=\{showContentEvidence\}/);
  assert.match(panel, /showEvidence \? <>/);
  assert.match(panel, /!evidenceOnly \? <>/);
  assert.match(panel, /source.id !== sourceId/);
  assert.match(panel, /return \(\) => \{ active = false; \}/);
  assert.match(panel, /expectedVersion|planningHandoffUpdate/);
  assert.match(panel, /칠판형은/);
  assert.match(panel, /AI 원고 생성에 자동 전달되지/);
  assert.doesNotMatch(panel, /generateContent|createDocument|dangerouslySetInnerHTML|method: "POST"/);
});

test("format changes remain reversible and preserve content and approvals", () => {
  let source = { id: "synthetic", version: 8, metadata: { planningHandoff: { ...input(), productionFormat: "board", openingHook: "synthetic hook" }, pipelineReviews: [{ synthetic: true }], researchBrief: { note: "retain" } } };
  for (const format of ["script", "mixed", "undecided", "board"]) {
    const previous = source.metadata.planningHandoff.productionFormat;
    const update = planningHandoffUpdate(source, { ...source.metadata.planningHandoff, productionFormat: format });
    assert.equal(update.expectedVersion, source.version);
    assert.deepEqual(update.metadata.pipelineReviews, source.metadata.pipelineReviews);
    assert.deepEqual(update.metadata.researchBrief, source.metadata.researchBrief);
    assert.equal(update.metadata.planningHandoff.openingHook, "synthetic hook");
    assert.deepEqual(Object.keys(update).sort(), ["expectedVersion", "id", "metadata"]);
    source = { ...source, version: source.version + 1, metadata: update.metadata };
    assert.deepEqual(readProductionFormatChange(source), { from: previous, to: format, sourceVersion: source.version - 1 });
  }
});
test("initial choice is not a format change; ordinary memo edits retain last-change note", () => {
  const initial = planningHandoffUpdate({ id: "test", version: 1, metadata: {} }, input());
  assert.equal(initial.metadata.productionFormatChange, undefined);
  const source = { id: "test", version: 4, metadata: { planningHandoff: input(), productionFormatChange: { from: "board", to: "undecided", sourceVersion: 2 } } };
  const update = planningHandoffUpdate(source, { ...input(), openingHook: "new note" });
  assert.deepEqual(update.metadata.productionFormatChange, source.metadata.productionFormatChange);
});
test("invalid or mismatched format history cannot be presented as current", () => {
  for (const change of [{ from: "board", to: "script", sourceVersion: 2 }, { from: "board", to: "undecided", sourceVersion: 4 }, { from: "undecided", to: "undecided", sourceVersion: 2 }, { from: "board", to: "undecided", sourceVersion: 2, approved: true }])
    assert.equal(readProductionFormatChange({ version: 4, metadata: { planningHandoff: input(), productionFormatChange: change } }), null);
  assert.throws(() => planningHandoffUpdate({ id: "test", version: 1, metadata: { planningHandoff: "corrupt" } }, input()));
});
