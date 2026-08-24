import assert from "node:assert/strict";
import test from "node:test";

import { buildMeetingMarkdown, meetingPath, responseText } from "../api/meetings.mjs";

test("meetingPath maps inbox and organized folders", () => {
  assert.equal(meetingPath("MTG-20260824-103000", "inbox", "2026-08-24T10:30:00+09:00"), "06_meetings/inbox/MTG-20260824-103000.md");
  assert.equal(meetingPath("MTG-20260824-103000", "organized", "2026-08-24T10:30:00+09:00"), "06_meetings/organized/2026/MTG-20260824-103000.md");
});

test("buildMeetingMarkdown creates canonical meeting frontmatter", () => {
  const markdown = buildMeetingMarkdown({
    id: "MTG-20260824-103000",
    title: "주간 콘텐츠 회의",
    meetingDate: "2026-08-24T10:30",
    owner: "ricky",
    participants: ["ricky", "jay"],
    destination: "organized",
    location: "office",
    process: "longform",
    contentId: "BA-0268",
    sourceType: "recording",
    transcriptStatus: "completed",
    summaryStatus: "completed",
    body: "## 한 줄 요약\n\n편집 방향 확정",
  }, { version: 2, createdAt: "2026-08-24T01:00:00.000Z" });
  assert.match(markdown, /entity_type: "meeting"/);
  assert.match(markdown, /status: "organized"/);
  assert.match(markdown, /participants: \["ricky", "jay"\]/);
  assert.match(markdown, /version: 2/);
  assert.match(markdown, /## 한 줄 요약/);
});

test("buildMeetingMarkdown quotes YAML-looking strings", () => {
  const markdown = buildMeetingMarkdown({
    id: "MTG-20260824-103001",
    title: "null",
    meetingDate: "2026-08-24T10:30",
    owner: "ricky",
    participants: ["ricky"],
    destination: "inbox",
    location: "-",
    process: null,
    contentId: null,
    sourceType: "manual",
    transcriptStatus: "not_required",
    summaryStatus: "draft",
    body: "메모",
  });
  assert.match(markdown, /title: "null"/);
  assert.match(markdown, /location: "-"/);
});

test("responseText extracts Responses API output text", () => {
  assert.equal(responseText({ output: [{ content: [{ type: "output_text", text: "## 한 줄 요약" }] }] }), "## 한 줄 요약");
});
