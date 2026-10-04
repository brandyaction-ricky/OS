import test from "node:test";
import assert from "node:assert/strict";
import {meetingTabHref,scheduleTabHref} from "../lib/fullscreen-tabs.ts";
test("combined screens keep their historical addresses and remove unrelated selection",()=>{
  assert.equal(meetingTabHref("decisions","meeting=one&filter=own"),"/home/decisions?filter=own&tab=decisions");
  assert.equal(meetingTabHref("meetings","record=one&tab=decisions"),"/organization/meetings?tab=meetings");
  assert.equal(scheduleTabHref("leave"),"/organization/leave");
  assert.equal(scheduleTabHref("schedule"),"/organization/schedule");
});
