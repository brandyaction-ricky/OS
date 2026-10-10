import assert from "node:assert/strict";
import test from "node:test";
import { loginExpiredNearSlot,missedScheduleSlots,silentScheduleSlot,upcomingScheduleSlots } from "../lib/content-automation-schedule.ts";

const rules={enabled:true,days:"daily",times:["09:00","13:00"],grace_minutes:15};
const at=(time)=>new Date(`2026-10-12T${time}:00+09:00`);
const run=(via,slot,time,browser_id="main")=>({via,slot,started_at:at(time).toISOString(),browser_id});

test("a scheduled run is matched by slot and main browser rather than wall-clock proximity",()=>{
  assert.deepEqual(missedScheduleSlots(rules,[run("now",null,"09:05"),run("sched","13:00","13:20")],"main",at("13:30")).map(row=>row.slot),["09:00"]);
  assert.equal(silentScheduleSlot(rules,[run("now",null,"09:05"),run("sched","13:00","13:20")],"main",at("13:30")),null);
  assert.deepEqual(missedScheduleSlots(rules,[run("sched","09:00","09:05","other")],"main",at("09:20")).map(row=>row.slot),["09:00"]);
});

test("grace, weekday and a later recovery run control the silent indicator",()=>{
  assert.equal(silentScheduleSlot(rules,[],"main",at("09:15")),null);
  assert.equal(silentScheduleSlot(rules,[],"main",at("09:16"))?.slot,"09:00");
  assert.equal(silentScheduleSlot(rules,[run("now",null,"09:18")],"main",at("09:30")),null);
  assert.equal(silentScheduleSlot({...rules,days:"weekdays"},[],"main",new Date("2026-10-11T09:30:00+09:00")),null);
});

test("upcoming slots preserve Korean dates and skip a missed time",()=>{
  const slots=upcomingScheduleSlots(rules,at("09:01"),2);
  assert.deepEqual(slots.map(row=>row.at.toISOString()),[
    at("13:00").toISOString(),
    new Date("2026-10-13T09:00:00+09:00").toISOString(),
    new Date("2026-10-13T13:00:00+09:00").toISOString(),
  ]);
});

test("a stale or later login expiry is not blamed for a missed scheduled slot",()=>{
  const slot=at("09:00").toISOString();
  assert.equal(loginExpiredNearSlot(at("09:18").toISOString(),slot),true);
  assert.equal(loginExpiredNearSlot(at("08:54").toISOString(),slot),false);
  assert.equal(loginExpiredNearSlot(at("10:01").toISOString(),slot),false);
  assert.equal(loginExpiredNearSlot(null,slot),false);
});
