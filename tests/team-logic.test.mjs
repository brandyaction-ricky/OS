import assert from "node:assert/strict";
import test from "node:test";
import { publicAbsences } from "../lib/team/absence.ts";
import { teamBrand, teamBusiness } from "../lib/team/business.ts";
import { recordDateColumn, recordDateRange } from "../lib/team/dates.ts";
import { teamDecisions } from "../lib/team/decisions.ts";
import { legacyMeetingPairs } from "../lib/team/duplicates.ts";
import { taskSource } from "../lib/team/source.ts";
import { legacyMeetingStatus, taskColumn, taskStatusForColumn } from "../lib/team/status.ts";

test("old business labels normalize while unknown values stay unassigned", () => {
  assert.equal(teamBrand("자영업 교육"), "브랜디액션 에듀");
  assert.equal(teamBusiness("마이인(진단)")?.key, "myin");
  assert.equal(teamBrand("unknown"), null);
});

test("team task status keeps existing todo variants and requires a blocked reason in UI", () => {
  assert.equal(taskColumn("todo"), "todo");
  assert.equal(taskColumn("blocked"), "blocked");
  assert.equal(taskStatusForColumn("todo", "backlog"), "backlog");
  assert.equal(taskStatusForColumn("todo", "blocked"), "planned");
  assert.equal(taskSource({ metadata: { kind: "telegram_answer_feedback" }, parent_id: null }), "telegram");
});

test("legacy meetings enter review only when they contain evidence and no linked work", () => {
  const meeting = { status: "active", description: "", metadata: { summary: "검수할 내용" } };
  assert.equal(legacyMeetingStatus(meeting, 0), "review");
  assert.equal(legacyMeetingStatus(meeting, 1), "active");
});

test("legacy duplicate search requires same KST day and business", () => {
  const base = { legacy: true, starts_at: "2026-09-23T00:30:00+09:00", metadata: {}, title: "마이인 주간 회의", brand: "마이인" };
  const same = { ...base, id: "b", title: "마이인 회의" };
  assert.equal(legacyMeetingPairs([{ ...base, id: "a" }, same]).length, 1);
  assert.equal(legacyMeetingPairs([{ ...base, id: "a" }, { ...same, brand: "브랜디액션 에듀" }]).length, 0);
});

test("absence projection excludes partner and shared accounts and sensitive leave details", () => {
  const requests = [
    { hr_employee_id: "e1", start_date: "2026-10-15", end_date: "2026-10-16", leave_type: "half_am", reason: "private" },
    { hr_employee_id: "e2", start_date: "2026-10-15", end_date: "2026-10-15", leave_type: "sick", reason: "private" },
  ];
  const employees = [{ id: "e1", profile_id: "p1", display_name: "직원" }, { id: "e2", profile_id: "p2", display_name: "파트너" }];
  const profiles = [{ id: "p1", is_active: true, is_shared_account: false, member_kind: "staff" }, { id: "p2", is_active: true, is_shared_account: false, member_kind: "partner" }];
  assert.equal(JSON.stringify(publicAbsences(requests, employees, profiles)), JSON.stringify([{ name: "직원", start: "2026-10-15", end: "2026-10-16", part: "am" }]));
});

test("date range uses due dates for tasks and exclusive KST start dates for meetings", () => {
  assert.equal(recordDateColumn("task"), "due_date");
  assert.equal(recordDateColumn("content_publish"), "starts_at");
  assert.equal(JSON.stringify(recordDateRange("2026-10-01", "2026-11-01")), JSON.stringify({ from: "2026-10-01", to: "2026-11-01" }));
  assert.equal(recordDateRange("2026-11-01", "2026-10-01"), null);
});

test("decision log uses record state and does not resurrect superseded meeting metadata", () => {
  const meeting = { id: "m", status: "done", metadata: { items: [{ id: "i", kind: "decision", text: "기존", state: "accepted" }] } };
  const record = { id: "d", title: "기존", status: "superseded", brand: "마이인", parent_id: "m", metadata: { meetingItemId: "i", replacedBy: "new" }, created_by: "p", created_at: "2026-10-01", version: 2 };
  const rows = teamDecisions([record], [meeting]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].replacedBy, "new");
});
