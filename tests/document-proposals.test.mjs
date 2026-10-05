import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("canonical proposal migration is additive, service-only, version-checked and approval history is recorded", async () => {
  const [sql, manifest, rollbackTest] = await Promise.all([
    read("supabase/migrations/20261003151000_document_change_proposals.sql"),
    read("supabase/migration-baseline.json").then(JSON.parse),
    read("supabase/tests/document_change_proposals.test.sql"),
  ]);
  assert.match(sql, /create table if not exists public\.os_document_proposals/);
  assert.match(sql, /create table if not exists public\.os_document_proposal_comments/);
  assert.match(sql, /revoke all on public\.os_document_proposals from public, anon, authenticated/);
  assert.match(sql, /public\.os_can_approve\(v_actor, p\.author_id\)/);
  assert.match(sql, /d\.current_version <> p\.base_version/);
  assert.match(sql, /OS_CANONICAL_PROPOSAL_REQUIRED/);
  assert.match(sql, /update public\.os_documents set title = p\.title, content_md = p\.content_md/);
  assert.doesNotMatch(sql, /\b(?:drop table|drop column|truncate|delete from)\b/i);
  assert.match(rollbackTest, /rollback;/);
  const entry = manifest.forwardMigrations.find((item) => item.file === "20261003151000_document_change_proposals.sql");
  assert.equal(entry?.requiresApproval, true);
  assert.equal(entry?.developmentApprovedAt, "2026-10-04");
  assert.equal(entry?.productionApprovedAt, "2026-10-05");
  assert.deepEqual(entry?.appliedEnvironments, ["development", "production"]);
});

test("canonical human and new-key write paths create proposals before changing the document", async () => {
  const [documents, agentDocuments, versions, sync, proposalApi] = await Promise.all([
    read("app/api/v1/documents/route.ts"), read("app/api/v1/knowledge-documents/route.ts"),
    read("app/api/v1/documents/[id]/versions/route.ts"), read("app/api/v1/knowledge/sync/route.ts"),
    read("app/api/v1/documents/proposals/route.ts"),
  ]);
  assert.match(documents, /current\.status === "canonical"[\s\S]*createCanonicalProposal[\s\S]*status: 202/);
  assert.match(agentDocuments, /actor\.enforceWriteStatuses[\s\S]*createCanonicalProposal[\s\S]*status: 202/);
  assert.match(versions, /document\.status === "canonical"[\s\S]*createCanonicalProposal[\s\S]*status: 202/);
  assert.match(sync, /counts\.proposed/);
  assert.match(proposalApi, /actor\.supabase\.rpc\("os_apply_document_proposal"/);
  assert.match(proposalApi, /readableKnowledgePages/);
});
