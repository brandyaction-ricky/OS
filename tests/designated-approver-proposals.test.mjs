import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canDecideProposal } from "../lib/knowledge/access.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const file = "20261013060000_designated_approver_own_proposals.sql";

test("any approver may decide proposals on own documents and own-AI drafts (owner decision 2026-10-18)", () => {
  const approver = { ownerId: "a", type: "user", role: "member", memberKind: "staff", allowedStatuses: ["canonical"], canApprove: true };
  const aiDraft = { author_id: "a", agent_owner_id: "a" };
  assert.equal(canDecideProposal(approver, aiDraft), true);
  // still needs approval authority and must respect a requested approver
  assert.equal(canDecideProposal({ ...approver, canApprove: false }, aiDraft), false);
  assert.equal(canDecideProposal(approver, { ...aiDraft, requested_approver_id: "b" }), false);
  assert.equal(canDecideProposal({ ...approver, role: "admin" }, { ...aiDraft, requested_approver_id: "b" }, "대리 처리"), true);
});

test("migration only widens proposal.decide for explicitly assigned approvers and is tracked for approval", async () => {
  const [sql, manifest] = await Promise.all([read(`supabase/migrations/${file}`), read("supabase/migration-baseline.json").then(JSON.parse)]);
  const helper = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.os_knowledge_workflow_command"));
  assert.match(helper, /approval\.kind = 'approver'/);
  assert.doesNotMatch(helper, /role\s*=\s*'admin'/); // no admin fallback self-approval
  assert.match(sql, /not \(a='proposal\.decide' and public\.os_is_designated_approver\(u\)\)\s+and \(not public\.os_can_approve\(u,prop\.author_id\) or not public\.os_can_approve\(u,d\.owner_id\) or u=agent_owner\)/);
  assert.doesNotMatch(sql, /\b(?:drop table|drop column|truncate|delete from public\.os_documents)\b/i);
  const entry = manifest.forwardMigrations.find((item) => item.file === file);
  assert.equal(entry?.sha256, createHash("sha256").update(sql).digest("hex"));
  assert.equal(entry?.requiresApproval, true);
});

test("API and review screens rely on approval authority alone, without an author exclusion", async () => {
  const [route, workspace, review] = await Promise.all([
    read("app/api/v1/documents/proposals/route.ts"), read("app/api/v1/knowledge/workspace/route.ts"), read("components/knowledge-proposal-review.tsx"),
  ]);
  assert.match(route, /rpc\("os_can_approve", \{ p_actor: actor\.id, p_author: proposal\.author_id \}\)/);
  assert.doesNotMatch(route + workspace, /isDesignatedApprover/);
  assert.match(review, /setCanApprove\(permission\.canApprove\)/);
  assert.doesNotMatch(review, /author_id !== profile\?\.id\)\)/);
});

test("every approver is offered, the author included", async () => {
  const { approverChoices } = await import("../lib/knowledge/access.ts");
  const people = [{ id: "a", can_approve: true, member_kind: "staff" }, { id: "b", can_approve: true, member_kind: "staff" }, { id: "c", can_approve: false, member_kind: "staff" }, { id: "p", can_approve: true, member_kind: "partner" }];
  assert.deepEqual(approverChoices(people).map((p) => p.id), ["a", "b"]);
  const [canon, editor] = await Promise.all([read("components/knowledge/canon.tsx"), read("components/knowledge/editor.tsx")]);
  assert.doesNotMatch(canon + editor, /designatedApprover|author_id!==actor\.ownerId|submitted_by!==actor\.ownerId/);
});
