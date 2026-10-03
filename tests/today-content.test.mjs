import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTodayContent } from "../lib/today-content.ts";
const now = new Date("2026-10-03T12:00:00+09:00");
const post = (id, owner, status = "scheduled") => ({ id, status, starts_at: "2026-10-02T12:00:00Z", metadata: { account: { platform: "threads", ownerId: owner } } });
test("today content excludes private and completed posts, includes authorized replies and deduplicates metrics", () => {
  const summary = summarizeTodayContent([post("own", "a"), post("private", "b"), post("done", "a", "published")],
    [{ status: "unanswered", canRespond: true }, { status: "unanswered", assignee_id: "a", canRespond: false }, { status: "replied", canRespond: true }, { status: "unanswered", canRespond: false }],
    [1, 2].map(id => ({ id: String(id), created_at: now.toISOString(), metadata: { channelSnapshotVersion: 1, publishId: "p" } })),
    [{ platform: "threads", ownerId: "a", status: "expired", expiresSoon: false }], "a", now);
  assert.deepEqual(summary.due.map(row => row.id), ["own"]);
  assert.equal(summary.unanswered.length, 2); assert.equal(summary.measured, 1); assert.equal(summary.warnings.length, 1);
});
test("missing or future measurements do not become today's measured count", () => {
  const summary = summarizeTodayContent([], [], [{ created_at: "2027-01-01", metadata: { channelSnapshotVersion: 1 } }, { created_at: now.toISOString(), metadata: { source: "manual" } }], [], "a", now);
  assert.equal(summary.measured, 0); assert.equal(summary.due.length, 0);
});
