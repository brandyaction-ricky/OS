import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const source = await readFile(new URL("../lib/development-links.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedModule = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${code}\n})`, { console })((name) => ({
  zod,
  "./http": { ApiError },
  "./development-requests": { isDevelopmentRequest: (record) => record?.record_type === "ai_job" && record.metadata?.kind === "development_request" },
}[name]), loadedModule, loadedModule.exports);
const { assertDevelopmentRequestLink, linkedDevelopmentRequestId } = loadedModule.exports;

function service(record, error = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      const builder = {
        select(fields) { calls.push(["select", fields]); return builder; },
        eq(field, value) { calls.push(["eq", field, value]); return builder; },
        is(field, value) { calls.push(["is", field, value]); return builder; },
        async maybeSingle() { return { data: record, error }; },
      };
      return builder;
    },
  };
}

const projectId = "80950395-23b2-4b5a-bd0f-c3d8b8b78d92";
const requestId = "28e1749d-92b9-476b-a17c-eb5be59d2822";
const request = { id: requestId, parent_id: projectId, record_type: "ai_job", metadata: { kind: "development_request" } };

test("development request links normalize a supplied request ID and ignore unrelated records", async () => {
  assert.equal(linkedDevelopmentRequestId({ requestId: `  ${requestId}  ` }), requestId);
  assert.equal(linkedDevelopmentRequestId({ requestId: null }), null);
  const db = service(request);
  await assertDevelopmentRequestLink(db, { recordType: "task", parentId: projectId, metadata: { requestId } });
  assert.equal(db.calls.length, 0);
});

test("development logs and deployments can link only to a request in the same project", async () => {
  const db = service(request);
  await assertDevelopmentRequestLink(db, { recordType: "development_log", parentId: projectId, metadata: { requestId } });
  assert.deepEqual(db.calls[0], ["from", "os_records"]);

  await assert.rejects(
    () => assertDevelopmentRequestLink(service(request), { recordType: "deployment", parentId: "96da9dff-dad1-4ad8-9530-d16fb11c9ff7", metadata: { requestId } }),
    (error) => error.code === "DEVELOPMENT_REQUEST_PROJECT_MISMATCH" && error.status === 409,
  );
});

test("invalid, missing and non-request links are rejected before a history record is created", async () => {
  await assert.rejects(
    () => assertDevelopmentRequestLink(service(request), { recordType: "development_log", parentId: projectId, metadata: { requestId: "not-a-uuid" } }),
    (error) => error.code === "INVALID_DEVELOPMENT_REQUEST_LINK" && error.status === 400,
  );
  await assert.rejects(
    () => assertDevelopmentRequestLink(service(null), { recordType: "development_log", parentId: projectId, metadata: { requestId } }),
    (error) => error.code === "DEVELOPMENT_REQUEST_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    () => assertDevelopmentRequestLink(service({ ...request, metadata: {} }), { recordType: "deployment", parentId: projectId, metadata: { requestId } }),
    (error) => error.code === "DEVELOPMENT_REQUEST_NOT_FOUND" && error.status === 404,
  );
});
