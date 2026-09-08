import assert from "node:assert/strict";
import test from "node:test";
import { canMovePublication, localCalendarDate, localCalendarTime, movePublicationDate } from "../lib/publishing-calendar.ts";

function inTimeZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("Korea morning publications appear on their local day with matching clock time", () => {
  inTimeZone("Asia/Seoul", () => {
    const starts_at = "2026-09-07T16:30:00.000Z";
    assert.equal(localCalendarDate(starts_at), "2026-09-08");
    assert.equal(localCalendarTime(starts_at), "01:30");
    const changed = movePublicationDate({ status: "scheduled", starts_at }, "2026-09-10");
    assert.equal(changed.startsAt, "2026-09-09T16:30:00.000Z");
    assert.equal(localCalendarDate(changed.startsAt), "2026-09-10");
  });
});

test("moving a publication preserves wall time across a daylight saving boundary", () => {
  inTimeZone("America/New_York", () => {
    const moved = movePublicationDate({ status: "ready", starts_at: "2026-03-07T14:30:00.000Z" }, "2026-03-09");
    assert.equal(localCalendarTime(moved.startsAt), "09:30");
    assert.equal(moved.startsAt, "2026-03-09T13:30:00.000Z");
  });
});

test("moving drafts never approves them and completed publications cannot be moved", () => {
  for (const status of ["draft", "review", "ready", "scheduled", "blocked"]) {
    assert.equal(canMovePublication(status), true);
    assert.deepEqual(Object.keys(movePublicationDate({ status, starts_at: "2026-09-07T12:00:00Z" }, "2026-09-10")), ["startsAt"]);
  }
  for (const status of ["published", "done", "archived", "unknown"]) {
    assert.equal(canMovePublication(status), false);
    assert.equal(movePublicationDate({ status, starts_at: "2026-09-07T12:00:00Z" }, "2026-09-10"), null);
  }
});

test("invalid dates do not produce malformed updates", () => {
  const record = { status: "ready", starts_at: "2026-09-07T12:00:00Z" };
  for (const date of ["", "invalid", "2026-02-30", "2026-13-01"]) assert.equal(movePublicationDate(record, date), null);
  assert.equal(movePublicationDate({ ...record, starts_at: null }, "2026-09-10"), null);
  assert.equal(localCalendarDate("invalid"), "");
  assert.equal(localCalendarTime(null), "");
});
