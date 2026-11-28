import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function loadGeneration(fetchStub) {
  const source = readFileSync(new URL("../lib/server/content-generation.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(`${source}\nexport { outputSchema as __outputSchema, claude as __claude };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(code, {
    module: compiled,
    exports: compiled.exports,
    AbortSignal,
    fetch: fetchStub,
    process: { env: { ANTHROPIC_API_KEY: "test-only-key" } },
    require(name) {
      if (name === "zod") return require("zod");
      if (name === "@/lib/http") return { ApiError };
      if (name.startsWith("@/") || name === "./content-generation-queue" || name === "./content-automation-settings") return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return compiled.exports;
}

test("appeal schema uses only supported structured-output constraints", async () => {
  let sent;
  const generation = loadGeneration(async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{}" }] }) };
  });

  await generation.__claude("test prompt", "test-model", generation.__outputSchema("appeal_candidates"), 7000);
  const candidates = sent.output_config.format.schema.properties.candidates;
  assert.equal(candidates.minItems, undefined);
  assert.equal(candidates.maxItems, undefined);
  assert.equal(candidates.items.properties.text.maxLength, undefined);
  assert.equal(candidates.items.properties.text.type, "string");
  assert.deepEqual(Array.from(sent.output_config.format.schema.required), ["candidates", "score", "review"]);
});

test("provider errors distinguish invalid requests from temporary failures without exposing provider details", async () => {
  for (const [status, code] of [[400, "CLAUDE_REQUEST_INVALID"], [401, "CLAUDE_AUTH_FAILED"], [429, "CLAUDE_TEMPORARILY_UNAVAILABLE"], [529, "CLAUDE_TEMPORARILY_UNAVAILABLE"]]) {
    const generation = loadGeneration(async () => ({ ok: false, status, json: async () => ({ error: { message: "private provider detail" } }) }));
    await assert.rejects(
      generation.__claude("test prompt", "test-model", generation.__outputSchema("appeal_candidates"), 7000),
      (error) => error.code === code && !error.message.includes("private provider detail"),
    );
  }
});

test("필수 제작 정본은 동명 문서와 누락을 확인하고 유일한 승인본을 고른다", async () => {
  const generation = loadGeneration();
  const rows = [];
  const db = { from() { return { select() { return this; }, in() { return this; }, order() { return { data: rows }; } }; } };
  await assert.rejects(generation.namedProcedures(db, ["기준"], true), /미등록/);
  rows.push({ id: "team", title: "기준", current_version: 1, status: "team" });
  rows.push({ id: "company", title: "기준", current_version: 5, status: "canonical" });
  const refs = await generation.namedProcedures(db, ["기준"], true);
  assert.equal(refs[0].id, "company"); assert.equal(refs[0].version, 5);
  rows.push({ id: "other", title: "기준", current_version: 2, status: "canonical" });
  await assert.rejects(generation.namedProcedures(db, ["기준"], true), /여러 개/);
});
