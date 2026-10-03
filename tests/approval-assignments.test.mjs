import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { changesAppealDecision, isAppealCandidatePackage } from "../lib/appeal-decision-guard.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("approval migration is additive, self-approval-safe, and gated for DEV review", async () => {
  const [sql, manifest, devTest] = await Promise.all([
    read("supabase/migrations/20261003143000_document_approval_assignments.sql"),
    read("supabase/migration-baseline.json").then(JSON.parse),
    read("supabase/tests/document_approval_assignments.test.sql"),
  ]);
  assert.match(sql, /p_actor is distinct from p_author/);
  assert.match(sql, /public\.os_can_approve\(v_uid, d\.owner_id\)/);
  assert.match(sql, /kind = 'delegate'.*current_date between delegation\.starts_on and delegation\.ends_on/s);
  assert.match(sql, /revoke all on public\.os_approval_assignments from public, anon, authenticated/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /OS_APPEAL_DECISION_API_REQUIRED/);
  assert.match(sql, /OS_APPEAL_APPROVAL_DENIED/);
  assert.doesNotMatch(sql, /\b(?:drop table|drop column|truncate|delete from)\b/i);
  assert.match(devTest, /author status transition fails at database boundary/);
  const entry = manifest.forwardMigrations.find((item) => item.file === "20261003143000_document_approval_assignments.sql");
  assert.equal(entry?.requiresApproval, true);
  assert.deepEqual(entry?.appliedEnvironments, []);
});

test("generic record writes cannot replace candidate decisions or their history", () => {
  const current = { packageKind: "appeal_candidates", result: { candidates: [{ text: "A", decision: "pending" }] }, decisionHistory: [] };
  assert.equal(isAppealCandidatePackage("content_package", current), true);
  assert.equal(changesAppealDecision(current, { ...current, result: { candidates: [{ text: "A", decision: "approved" }] } }), true);
  assert.equal(changesAppealDecision(current, { ...current, decisionHistory: [{ decision: "approved" }] }), true);
  assert.equal(changesAppealDecision(current, { ...current, description: "ordinary edit" }), false);
});

test("approval routes fail closed and the review UI uses the server decision", async () => {
  const [management, status, inbox, records, appeal] = await Promise.all([
    read("app/api/v1/approvals/route.ts"),
    read("app/api/v1/documents/[id]/status/route.ts"),
    read("components/review-inbox.tsx"),
    read("app/api/v1/records/route.ts"),
    read("app/api/v1/content/appeals/decide/route.ts"),
  ]);
  assert.match(management, /actor\.role !== "admin"/);
  assert.match(management, /APPROVER_REQUIRED/);
  assert.match(management, /os_can_approve/);
  assert.match(status, /STATUS_CHANGE_DENIED/);
  assert.match(inbox, /disabled=\{busy \|\| !approvalLoaded \|\| !canApprove\}/);
  assert.match(records, /APPEAL_DECISION_API_REQUIRED/);
  assert.match(appeal, /os_decide_appeals/);
});
