import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function loadTypeScript(relativePath) {
  const source = awaitableRead(relativePath);
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: compiled, exports: compiled.exports,
    require(name) { if (name === "zod") return require("zod"); throw Error(name); },
  });
  return compiled.exports;
}
function awaitableRead(relativePath) {
  return fileCache.get(relativePath);
}
const fileCache = new Map();
for (const path of ["../lib/content-planning-handoff.ts", "../lib/content-planning-handoff-gate.ts"]) {
  fileCache.set(path, await readFile(new URL(path, import.meta.url), "utf8"));
}
const handoff = loadTypeScript("../lib/content-planning-handoff.ts");
const gate = loadTypeScript("../lib/content-planning-handoff-gate.ts");

test("handoff safely updates only its metadata and preserves unrelated topic data", () => {
  const source = { id: "topic-1", version: 4, metadata: { audience: "founders", pipelineRuns: [{ state: "done" }] } };
  const input = { schemaVersion: 1, productionFormat: "board", contentApproach: "mixed", titlePromise: "A clear promise", thumbnailCopy: "Why now?", openingHook: "Start with the data", evidenceNotes: "Source link", unresolved: "Verify one number", sharingNotes: "Editor may reuse this" };
  const update = handoff.planningHandoffUpdate(source, input);
  assert.equal(update.expectedVersion, 4);
  assert.equal(update.metadata.audience, "founders");
  assert.deepEqual(update.metadata.pipelineRuns, source.metadata.pipelineRuns);
  assert.equal(update.metadata.planningHandoff.productionFormat, "board");
  const changed = handoff.planningHandoffUpdate({ ...source, metadata: update.metadata, version: 5 }, { ...input, productionFormat: "script" });
  assert.equal(changed.metadata.productionFormatChange.from, "board");
  assert.equal(changed.metadata.productionFormatChange.to, "script");
  assert.equal(changed.metadata.productionFormatChange.sourceVersion, 5);
  assert.throws(() => handoff.planningHandoffUpdate(source, { ...input, thumbnailCopy: "x".repeat(501) }));
});

test("production UI stays hidden unless production database and deployment all match", () => {
  const env = { CONTENT_PLANNING_HANDOFF_ENABLED: "true", OS_ENVIRONMENT: "production", NEXT_PUBLIC_DEMO_MODE: "false", SYSTEM_ONE_DEV_SUPABASE_REF: "gjmqkrxhoibopmoeiwtd", SYSTEM_ONE_PRODUCTION_SUPABASE_REF: "evnbriltxiqgglnftlrw", NEXT_PUBLIC_SUPABASE_URL: "https://evnbriltxiqgglnftlrw.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "present", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" };
  assert.equal(gate.canUseContentPlanningHandoff(env), true);
  assert.equal(gate.canUseContentPlanningHandoff({ ...env, VERCEL_ENV: "preview" }), false);
  assert.equal(gate.canUseContentPlanningHandoff({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://gjmqkrxhoibopmoeiwtd.supabase.co" }), false);
  assert.equal(gate.canUseContentPlanningHandoff({ ...env, VERCEL_GIT_COMMIT_REF: "codex/feature" }), false);
  assert.equal(gate.canUseContentPlanningHandoff({ ...env, CONTENT_PLANNING_HANDOFF_ENABLED: "false" }), false);
});
