import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { agentReadableStatuses, canReadKnowledgeDocument, canAgentEditDraft } from "../lib/server/document-access.ts";

const actor = (overrides = {}) => ({
  type: "agent",
  role: "member",
  ownerId: "owner-a",
  allowedStatuses: ["canonical", "team"],
  ...overrides,
});
const document = (status, owner_id = "owner-b") => ({ status, owner_id });
test("AI keys can only edit their own generated draft, never human notes or team bodies",()=>{
  assert.equal(canAgentEditDraft(actor(),{...document("draft","owner-a"),source:"mcp"}),true);
  for(const doc of [{...document("draft","owner-a"),source:"manual"},{...document("team","owner-a"),source:"mcp"},{...document("draft"),source:"mcp"},{...document("canonical","owner-a"),source:"mcp"}])assert.equal(canAgentEditDraft(actor(),doc),false);
});

test("read-only AI keys include team documents and own AI drafts without granting writes", () => {
  assert.deepEqual(agentReadableStatuses(["canonical"]), ["canonical", "team", "draft"]);
  assert.deepEqual(agentReadableStatuses(["team", "canonical"]), ["team", "canonical", "draft"]);
});

test("AI draft read requires explicit read status, same owner and MCP provenance", () => {
  const reader = actor({ allowedStatuses: agentReadableStatuses(["canonical"]) });
  const ownDraft = { ...document("draft", "owner-a"), source: "mcp" };
  assert.equal(canReadKnowledgeDocument(reader, ownDraft), true);
  assert.equal(canReadKnowledgeDocument(actor(), ownDraft), false);
  for (const source of [undefined, "manual", "obsidian_vault"]) {
    assert.equal(canReadKnowledgeDocument(reader, { ...ownDraft, source }), false);
  }
  assert.equal(canReadKnowledgeDocument(reader, { ...ownDraft, owner_id: "owner-b" }), false);
  assert.equal(canReadKnowledgeDocument(reader, { ...ownDraft, status: "archived" }), false);
});

test("all members and AI keys can read another owner's team-shared document", () => {
  assert.equal(canReadKnowledgeDocument(actor(), document("team")), true);
  assert.equal(canReadKnowledgeDocument(actor({ type: "user" }), document("team")), true);
});

test("another owner's draft and archived document stay private", () => {
  assert.equal(canReadKnowledgeDocument(actor({ allowedStatuses: ["draft", "team", "canonical"] }), document("draft")), false);
  assert.equal(canReadKnowledgeDocument(actor(), document("archived")), false);
  assert.equal(canReadKnowledgeDocument(actor(), document("draft", "owner-a")), false);
});

test("the change does not expose another owner's review drafts to AI keys", () => {
  assert.equal(canReadKnowledgeDocument(actor({ allowedStatuses: ["team", "review", "reviewed", "canonical"] }), document("review")), false);
  assert.equal(canReadKnowledgeDocument(actor({ allowedStatuses: ["team", "review", "reviewed", "canonical"] }), document("reviewed")), false);
});

test("routes, search, key defaults, and RLS migration share one team-read contract", async () => {
  const [knowledgeRoute, documentRoute, search, keyRoute, migration] = await Promise.all([
    readFile(new URL("../app/api/v1/knowledge-documents/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/documents/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/search.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent-key-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260929062422_share_team_documents_with_all_members.sql", import.meta.url), "utf8"),
  ]);
  assert.match(knowledgeRoute, /canReadKnowledgeDocument\(actor, data\)/);
  assert.match(documentRoute, /readableKnowledgePages\(actor, \[data\]\)/);
  assert.match(documentRoute, /DOCUMENT_NOT_FOUND/);
  assert.match(search, /status\.eq\.canonical,status\.eq\.team,and\(status\.eq\.draft,owner_id\.eq\.\$\{actor.ownerId\},source\.eq\.mcp\)/);
  assert.match(search, /status === "canonical" \|\| status === "team"/);
  assert.match(keyRoute, /\["team", "canonical"\]/);
  assert.match(migration, /when p_status = 'team' then public\.os_is_active_member\(\)/);
  assert.match(migration, /when p_status = 'draft' then false/);
  assert.doesNotMatch(migration, /drop table|truncate\s/i);
});
