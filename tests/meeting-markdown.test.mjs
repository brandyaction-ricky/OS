import assert from "node:assert/strict";
import test from "node:test";
import { meetingFileName, meetingMarkdown } from "../lib/meeting-markdown.ts";

test("meeting markdown lists decisions, tasks with owner and due date, open items and the transcript; discarded items are left out", () => {
  const names = { a: "안저", b: "제이" };
  const md = meetingMarkdown({
    title: "마이인 주간 회의", startsAt: "2026-10-25T01:00:00Z", business: "마이인", attendees: ["a", "b"],
    agenda: "1. 매출 점검", summary: "- 매출 회복", transcript: "원문 전체",
    items: [
      { kind: "decision", text: "광고비 10% 증액", state: "accepted" },
      { kind: "task", text: "상세페이지 수정", state: "accepted", ownerId: "b", dueOn: "2026-10-31" },
      { kind: "task", text: "담당 미정 일", state: "pending" },
      { kind: "open", text: "가격 정책", state: "accepted" },
      { kind: "decision", text: "버린 결정", state: "discarded" },
    ],
    nameOf: id => names[id] ?? "구성원",
  });
  assert.match(md, /^# 마이인 주간 회의\n/);
  assert.match(md, /- 참석: 안저, 제이/);
  assert.match(md, /## 결정\n\n- 광고비 10% 증액\n/);
  assert.match(md, /- \[ \] 상세페이지 수정 — 담당 제이 · 기한 2026-10-31\n/);
  assert.match(md, /- \[ \] 담당 미정 일 — 담당 미정 · 기한 미정 _\(검수 전\)_/);
  assert.match(md, /## 미결\n\n- 가격 정책/);
  assert.match(md, /## 회의 원문\n\n원문 전체\n$/);
  assert.doesNotMatch(md, /버린 결정/);
  assert.doesNotMatch(md, /\n\n\n/);
});

test("file name uses the Korean date and strips characters a file name cannot hold", () => {
  assert.equal(meetingFileName("주간/회의: 1차", "2026-10-24T16:30:00Z"), "2026-10-25 주간 회의 1차.md");
});
