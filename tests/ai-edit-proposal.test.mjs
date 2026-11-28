import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("an AI key's edit of a document it did not write becomes a proposal the document's owner decides", async () => {
  const [route, proposals, workspace, review, stage] = await Promise.all([
    read("app/api/v1/knowledge-documents/route.ts"), read("lib/server/document-proposals.ts"),
    read("app/api/v1/knowledge/workspace/route.ts"), read("components/knowledge/canon.tsx"), read("components/knowledge/stage.tsx"),
  ]);
  // no 403 for a readable document: a 202 proposal instead; someone else's note stays closed
  assert.match(route, /current\.status !== "draft" \|\| current\.owner_id === actor\.ownerId\) && canReadKnowledgeDocument\(actor, current\)/);
  assert.match(route, /if\(!direct \|\| \(!canAgentEditDraft\(actor,current\)/);
  assert.match(route, /proposalId: proposal\.id, proposal, indexing: "queued",[\s\S]{0,40}message:/);
  assert.match(route, /actor\.type === "agent" && current\.status !== "canonical" && actor\.allowedStatuses\.includes\(current\.status\)/);
  // the owner is the approver; people still only propose to canon
  assert.match(proposals, /if \(team && actor\.type !== "agent"\) throw new ApiError\(400, "CANONICAL_REQUIRED"/);
  assert.match(proposals, /let approver:string\|null=team\?current\.owner_id\?\?null:null;/);
  // approving saves with the decider's own edit right
  assert.match(proposals, /actor\.supabase\.rpc\("os_knowledge_command", \{ p: \{ action: "document\.commit", id: doc\.id, expectedVersion: doc\.current_version/);
  assert.match(proposals, /if \(!doc \|\| doc\.status === "canonical"\) return null;/);
  assert.match(proposals, /\.update\(patch\)\.eq\("id", prop\.id\)\.eq\("status", "open"\)/);
  assert.match(workspace, /parsed\.data\.action==="proposal\.decide"&&parsed\.data\.id\)\{const decided=await decideTeamProposal/);
  assert.match(review, /const allowed=team\?ownerDecides:canDecideProposal\(actor,p,reason\)/);
  assert.match(review, /team\?"승인하고 문서에 반영":"승인하고 정본에 반영"/);
  assert.match(stage, /AI 변경 제안 \{aiWaiting\.length\}건 보기/);
  assert.match(review, /\[item\.doc&&item\.doc\.status!=="canonical"\?"AI 변경 제안":"정본 변경","change"\]/, "the list card says so too");
});
