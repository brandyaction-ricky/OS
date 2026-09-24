import assert from "node:assert/strict";
import test from "node:test";
import { proposeSystemOneApplicability as propose } from "../lib/server/system-one-applicability.ts";
const ref = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, version: 1, fingerprint: "a".repeat(64) });
function input() {
  return { contractVersion: "scope-proposal-v1",
    context: { brand: "synthetic", stage: "planning", source: ref(1), facts: [] },
    plan: { brand: "synthetic", stage: "planning", registry: ref(2), rules: [
      { key: "base", source: ref(3), section: "Synthetic base", requirement: { kind: "required" } },
      { key: "conditional", source: ref(3), section: "Synthetic condition", requirement: { kind: "conditional", when: { fact: "uses_example", equals: true } } },
    ] }, current: { source: ref(1), registry: ref(2), documents: [ref(3)] } };
}
test("required applies but absent context never becomes false or a pass", () => {
  const result = propose(input());
  assert.equal(result.status, "proposal"); assert.equal(result.needsContext, true);
  assert.deepEqual(result.items.map(x => x.applicability), ["applies", "unknown"]);
  assert.equal(result.policyStatus, "unverified"); assert.equal(result.judgment, null); assert.equal(result.executionAllowed, false);
});
for (const value of [true, false, null]) test(`explicit three-state context ${value}`, () => {
  const data = input(); data.context.facts = [{ key: "uses_example", value, evidenceSection: value === null ? null : "Synthetic field" }];
  const result = propose(data);
  assert.equal(result.items[1].applicability, value === null ? "unknown" : value ? "applies" : "not_applicable");
  assert.equal(result.needsContext, value === null);
});
test("negative condition uses exact boolean equality", () => {
  const data = input(); data.plan.rules[1].requirement.when.equals = false;
  data.context.facts = [{ key: "uses_example", value: false, evidenceSection: "Synthetic" }];
  assert.equal(propose(data).items[1].applicability, "applies");
});
for (const field of ["source", "registry", "document"]) for (const changed of ["version", "fingerprint"]) {
  test(`reject stale ${field} ${changed}`, () => {
    const data = input(); const target = field === "document" ? data.current.documents[0] : data.current[field];
    target[changed] = changed === "version" ? 2 : "b".repeat(64);
    assert.equal(propose(data).code, "stale");
  });
}
test("excluded rules still require current policy evidence", () => {
  const data = input(); data.context.facts = [{ key: "uses_example", value: false, evidenceSection: "Synthetic" }];
  data.plan.rules[1].source = ref(4);
  assert.equal(propose(data).code, "reference_missing");
});
test("same document can supply multiple sections, but duplicate rule/fact IDs are rejected", () => {
  assert.equal(propose(input()).status, "proposal");
  for (const change of [d => d.plan.rules.push(d.plan.rules[0]), d => d.current.documents.push(ref(3)),
    d => d.context.facts.push(...Array(2).fill({ key: "same", value: null, evidenceSection: null }))]) {
    const data = input(); change(data); assert.equal(propose(data).code, "invalid_input");
  }
});
test("unknown fields, ungrounded facts, malformed conditions and oversized lists fail closed", () => {
  for (const change of [d => { d.executionAllowed = true; }, d => { d.context.facts = [{ key: "uses_example", value: false, evidenceSection: null }]; },
    d => { d.plan.rules[1].requirement.when.equals = "false"; }, d => { d.plan.rules = Array(31).fill(d.plan.rules[0]); },
    d => { d.plan.rules[0].approval = "canonical"; }, d => { d.current.source.fingerprint = "short"; }]) {
    const data = input(); change(data); assert.equal(propose(data).code, "invalid_input");
  }
});
test("brand and stage are bound without hardcoded company rules", () => {
  for (const field of ["brand", "stage"]) { const data = input(); data.context[field] = "other"; assert.equal(propose(data).code, "unsupported_context"); }
});
test("all excluded is not adoption; output is immutable and omits source/evidence bodies", () => {
  const data = input(); data.plan.rules = [data.plan.rules[1]];
  data.context.facts = [{ key: "uses_example", value: false, evidenceSection: "PRIVATE SYNTHETIC MARKER" }];
  const result = propose(data);
  assert.equal(result.judgment, null); assert.equal(result.executionAllowed, false);
  assert.equal(result.items[0].applicability, "not_applicable");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.items) && Object.isFrozen(result.items[0]));
});
