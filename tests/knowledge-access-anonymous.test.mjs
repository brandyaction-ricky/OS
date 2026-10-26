import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as access from "../lib/knowledge/access.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// Telegram asks as an agent with no ownerId; looking that up as a profile used to fail every question.
test("an agent with no owner reads open canon only, without touching profiles or named readers", async () => {
  const touched = [];
  const service = { from(table) { touched.push(table); throw Error(`must not query ${table}`); } };
  const code = ts.transpileModule(readFileSync(new URL("../lib/server/knowledge-access.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: name => ({ "@/lib/knowledge/access": access, "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => service } })[name] });
  const actor = { type: "agent", ownerId: "", role: "member", allowedStatuses: ["canonical"] };
  const doc = (id, patch = {}) => ({ id, owner_id: "someone", status: "canonical", reader_scope: "all", steward_id: "steward", category_id: null, meeting_record_id: null, archived_from_status: null, ...patch });
  const docs = [doc("open"), doc("restricted", { reader_scope: "named" }), doc("note", { status: "draft" })];
  const { actor: policy, context } = await exports.knowledgeAccessContext(actor, docs);
  assert.deepEqual(touched, []);
  assert.equal(access.canReadDocument(policy, docs[0], context), true);
  assert.equal(access.canReadDocument(policy, docs[1], context), false);
  assert.equal(access.canReadDocument(policy, docs[2], context), false);
});
