import test from "node:test";
import assert from "node:assert/strict";
import { canReadDocument, canEditDocument, canChangeCategory, canManageCategory, canDecideProposal, filterReadable } from "../lib/knowledge/access.ts";
import { buildKnowledgeGraph } from "../lib/knowledge-links.ts";
const actor = { ownerId: "a", type: "user", role: "member", memberKind: "staff", allowedStatuses: ["team", "canonical"], canApprove: true };
const doc = { id: "d", owner_id: "b", status: "team", title: "Shared", content_md: "", folder: "" };
const partner = { ...actor, memberKind: "partner" };
test("private notes are private even from admins and their owner's AI key", () => {
  for (const role of ["admin", "lead", "member"]) assert.equal(canReadDocument({ ...actor, role }, { ...doc, status: "draft" }), false);
  assert.equal(canReadDocument(actor, { ...doc, owner_id: "a", status: "draft" }), true);
  assert.equal(canReadDocument({ ...actor, type: "agent" }, { ...doc, owner_id: "a", status: "draft" }), false);
  assert.equal(canReadDocument({ ...actor, role: "admin" }, { ...doc, status: "archived", archived_from_status: "draft" }), false);
});
test("audited private-note grants allow reading, never editing or agent access",()=>{
  const privateDoc={...doc,status:"draft"},context={noteGrants:new Set([doc.id])},admin={...actor,role:"admin"};
  assert.equal(canReadDocument(admin,privateDoc,context),true);
  assert.equal(canEditDocument(admin,privateDoc,context),false);
  assert.equal(canReadDocument({...admin,type:"agent"},privateDoc,context),false);
  assert.equal(canReadDocument(admin,privateDoc,{noteGrants:new Set()}),false);
});
test("meeting documents never allow generic editing, even for an attendee administrator",()=>{
  const meetingDoc={...doc,meeting_record_id:"m"},context={meetings:new Map([["m",{visibility:"attendees",attendees:["a"]}]])};
  assert.equal(canReadDocument(actor,meetingDoc,context),true);
  assert.equal(canEditDocument({...actor,role:"admin"},meetingDoc,context),false);
});
test("AI may read an allowed shared document but cannot edit the human workspace",()=>{
 const agent={...actor,type:"agent"};assert.equal(canReadDocument(agent,doc),true);assert.equal(canEditDocument(agent,doc),false);
});
test("partner reads only allowed categories, own team work and canonical, never AI logs", () => {
  const context = { categories: new Map([["public", { partner_ids: ["a"] }]]) };
  assert.equal(canReadDocument(partner, doc, context), false);
  assert.equal(canReadDocument(partner, { ...doc, category_id: "public" }, context), true);
  assert.equal(canReadDocument(partner, { ...doc, owner_id: "a" }), true);
  assert.equal(canReadDocument(partner, { ...doc, status: "canonical" }), true);
  assert.equal(canReadDocument(partner, { ...doc, owner_id: "a", source: "mcp" }), false);
  assert.equal(canReadDocument(partner, { ...doc, owner_id: "a", source: "mcp", status:"draft" }), false);
  assert.equal(canReadDocument(partner, { ...doc, owner_id: "a", source: "mcp", status:"archived", archived_from_status:"draft" }), false);
  assert.equal(canEditDocument(partner, { ...doc, owner_id: "a" }), true);
  assert.equal(canChangeCategory(partner, { ...doc, owner_id: "a" }), false);
});
test("attendee-only meeting beats admin privileges, missing context denies", () => {
  const meetingDoc = { ...doc, meeting_record_id: "m" };
  const context = { meetings: new Map([["m", { visibility: "attendees", attendees: ["b"] }]]) };
  assert.equal(canReadDocument({ ...actor, role: "admin" }, meetingDoc, context), false);
  assert.equal(canReadDocument(actor, meetingDoc), false);
  assert.equal(canReadDocument({ ...partner, ownerId: "b" }, meetingDoc, context), true);
});
test("category and approval operations keep separation of duties", () => {
  assert.equal(canManageCategory(actor, { space: "team" }), true);
  assert.equal(canManageCategory(actor, { space: "team" }, true), false);
  assert.equal(canManageCategory(partner, { space: "team" }), false);
  assert.equal(canManageCategory(partner, { space: "mine", owner_id: "a" }), true);
  assert.equal(canDecideProposal(actor, { author_id: "a" }, doc), false);
  assert.equal(canDecideProposal(actor, { author_id: "c", agent_owner_id: "a" }, doc), false);
  assert.equal(canDecideProposal(actor, { author_id: "c", requested_approver_id: "b" }, doc), false);
  assert.equal(canDecideProposal({ ...actor, role: "admin" }, { author_id: "c", requested_approver_id: "b" }, doc, "대리 사유"), true);
});
test("archived meeting documents still deny non-attendees, including owners and admins", () => {
  const context = { meetings: new Map([["m", { visibility: "attendees", attendees: ["b"] }]]) };
  const archived = { ...doc, status: "archived", archived_from_status: "team", meeting_record_id: "m" };
  assert.equal(canReadDocument({ ...actor, role: "admin" }, archived, context), false);
  assert.equal(canReadDocument(actor, { ...archived, owner_id: "a", archived_by: "a" }, context), false);
  assert.equal(canReadDocument({ ...actor, role: "admin" }, archived), false);
  assert.equal(canReadDocument({ ...actor, ownerId: "b" }, archived, context), true);
});
test("graph resolves before filtering: hidden documents never become missing-link metadata", () => {
  const rows = [{ ...doc, content_md: "[[Private]] [[표지.png]] [[없는 문서]]" }, { ...doc, id: "hidden", status: "draft", title: "Private" }];
  const graph = buildKnowledgeGraph(rows, new Set(["d"]));
  assert.equal(graph.hiddenTargets, 1);
  assert.equal(graph.broken.length, 1);
  assert.equal(graph.broken[0].targetTitle, "없는 문서");
  assert.equal(JSON.stringify(graph).includes("Private"), false);
  assert.equal(JSON.stringify(graph).includes('"hidden"'), false);
  assert.equal(filterReadable(actor, rows).length, 1);
});
