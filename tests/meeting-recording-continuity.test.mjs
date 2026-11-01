import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createTranscriptInbox } from "../lib/meeting-transcript-inbox.ts";

// 리키님 #177 이어받기 (2026-10-31): a meeting keeps recording in other menus; its transcripts wait and land on return.
test("transcripts wait per meeting and land in order on return; refused ones stay", () => {
  const inbox = createTranscriptInbox();
  inbox.push("m1", "첫 구간"); inbox.push("m2", "다른 회의"); inbox.push("m1", "둘째 구간");
  assert.equal(inbox.count("m1"), 2);
  const notes = [];
  assert.equal(inbox.flush("m1", text => { notes.push(text); return notes.length < 2; }), 1, "the notes refused the second segment");
  assert.deepEqual(notes, ["첫 구간", "둘째 구간"]);
  assert.equal(inbox.flush("m1", text => { notes.push(text); return true; }), 0);
  assert.deepEqual(notes.slice(-1), ["둘째 구간"]);
  assert.equal(inbox.count("m2"), 1, "another meeting's transcript never lands here");
  inbox.clear();
  assert.equal(inbox.count("m2"), 0);
});

test("both meeting screens use the one app-wide recorder, mounted around the whole app", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [layout, knowledge, team, recorder] = await Promise.all([read("app/(os)/layout.tsx"), read("components/knowledge/meeting-capture.tsx"), read("components/team/meeting-actions.tsx"), read("components/meeting-recorder.tsx")]);
  assert.match(layout, /<MeetingRecordingProvider>[\s\S]*<AppShell[\s\S]*<\/MeetingRecordingProvider>/);
  for (const screen of [knowledge, team]) {
    assert.match(screen, /useMeetingRecording\(\)/);
    assert.doesNotMatch(screen, /useSegmentedRecorder\(/, "a screen-owned recorder would stop when the screen closes");
  }
  assert.doesNotMatch(recorder, /이 화면을 닫지 마세요/);
});
