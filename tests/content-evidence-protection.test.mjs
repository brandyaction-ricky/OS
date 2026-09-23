import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isContentEvidence } from "../lib/content-evidence-protection.ts";

test("only the three evidence subtypes require the validated evidence endpoints", () => {
  for (const packageKind of ["copy_decision_evidence", "publication_copy_observation", "claim_evidence"])
    assert.equal(isContentEvidence("content_package", { packageKind }), true);
  assert.equal(isContentEvidence("content_package", { packageKind: "title_package" }), false);
  assert.equal(isContentEvidence("content_topic", { packageKind: "claim_evidence" }), false);
  assert.equal(isContentEvidence("content_package", null), false);
});

test("human and agent record routes both close create, update and archive bypasses", async () => {
  for (const route of ["records", "agent-records"]) {
    const source = await readFile(new URL(`../app/api/v1/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /isContentEvidence\(input\.recordType, input\.metadata\)/);
    assert.match(source, /isContentEvidence\(current\.record_type, current\.metadata\) \|\| isContentEvidence\(input\.recordType \?\? current\.record_type, input\.metadata\)/);
    assert.match(source, /if \(isContentEvidence\(current\.record_type, current\.metadata\)\)/);
    assert.match(source, /EVIDENCE_API_REQUIRED/);
    assert.match(source, /EVIDENCE_APPEND_ONLY/);
  }
});
