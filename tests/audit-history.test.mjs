import assert from "node:assert/strict";
import test from "node:test";
import { groupAuditHistory } from "../lib/audit-history.ts";

const event = (id, minute, options = {}) => ({
  id, actor_id: "author", actor_type: "user", subject_id: "document", subject_type: "knowledge_document",
  event_type: "updated", created_at: `2026-10-03T12:${String(minute).padStart(2, "0")}:00.000Z`, ...options,
});

test("consecutive edits within 30 minutes group without hiding each event", () => {
  const items = [event("a", 55), event("b", 30), event("c", 5)];
  const groups = groupAuditHistory(items);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].events.map(item => item.id), ["a", "b", "c"]);
  assert.equal(groups[0].newest, items[0].created_at);
  assert.equal(groups[0].oldest, items[2].created_at);
});

test("actor, object, decision and time gaps keep separate rows", () => {
  const groups = groupAuditHistory([
    event("a", 59), event("b", 58, { actor_id: "colleague" }),
    event("c", 57, { subject_id: "another" }),
    event("d", 56, { event_type: "status_changed" }),
    event("e", 25),
  ]);
  assert.equal(groups.length, 5);
});
