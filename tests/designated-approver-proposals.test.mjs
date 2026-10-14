import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canDecideProposal } from "../lib/knowledge/access.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const file = "20261013060000_designated_approver_own_proposals.sql";

test("designated approver may decide proposals on own documents and own-AI drafts; others keep the exclusion", () => {
  const approver = { ownerId: "a", type: "user", role: "admin", memberKind: "staff", allowedStatuses: ["canonical"], canApprove: true };
  const own = { id: "d", owner_id: "a", status: "canonical" };
  const aiDraft = { author_id: "a", agent_owner_id: "a" };
  assert.equal(canDecideProposal(approver, aiDraft, own), false);
  assert.equal(canDecideProposal({ ...approver, designatedApprover: true }, aiDraft, own), true);
  // still needs approval authority and must respect a requested approver
  assert.equal(canDecideProposal({ ...approver, designatedApprover: true, canApprove: false }, aiDraft, own), false);
  assert.equal(canDecideProposal({ ...approver, role: "member", designatedApprover: true }, { ...aiDraft, requested_approver_id: "b" }, own), false);
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

test("API and review screens use the same designated-approver exception", async () => {
  const [route, workspace, review] = await Promise.all([
    read("app/api/v1/documents/proposals/route.ts"), read("app/api/v1/knowledge/workspace/route.ts"), read("components/knowledge-proposal-review.tsx"),
  ]);
  assert.match(route, /else if \(!\(await isDesignatedApprover\(actor\.id\)\)\)/);
  assert.match(workspace, /designated:canApprove&&await isDesignatedApprover\(row\.id\)/);
  assert.match(workspace, /designatedApprover=me\?\.designated===true/);
  assert.match(review, /row\.kind === "approver" && row\.user_id === profile\?\.id/);
});

test("designated approver is offered as approver and passes every approval check; others keep the exclusion", async () => {
  const { approverChoices } = await import("../lib/knowledge/access.ts");
  const actor = { ownerId: "a", type: "user", role: "admin", allowedStatuses: [] };
  const people = [{ id: "a", can_approve: true, member_kind: "staff", designated: true }, { id: "b", can_approve: true, member_kind: "staff" }];
  assert.deepEqual(approverChoices(people, actor, { owner_id: "a" }).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(approverChoices(people, { ...actor, ownerId: "b" }, { owner_id: "b" }).map((p) => p.id), ["a"]);
  const sql = await read("supabase/migrations/20261014031500_designated_approver_everywhere.sql");
  assert.match(sql, /select public\.os_is_designated_approver\(p_actor\) or coalesce\(\s+p_actor is not null\s+and p_actor is distinct from p_author/);
  assert.doesNotMatch(sql, /os_publish_candidate/);
  const [canon, editor] = await Promise.all([read("components/knowledge/canon.tsx"), read("components/knowledge/editor.tsx")]);
  assert.doesNotMatch(canon + editor, /!\[actor\.ownerId,doc\.owner_id\]\.includes\(p\.id\)/);
});
