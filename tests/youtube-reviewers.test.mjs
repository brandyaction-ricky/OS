import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dueReviewers, kstDay, markReviewed, setReviewers } from "../lib/youtube-process/reviewers.ts";

// 유쓰 요청 8/8 (2026-11-02): 검토할 사람 · 날짜 — reminders only for those not finished, no new approval step.
const yuth = "11111111-1111-4111-8111-111111111111", logan = "22222222-2222-4222-8222-222222222222";

test("a kept reviewer keeps 검토 끝; only new parts or new dates are told", () => {
  const first = setReviewers([], [{ id: yuth, part: "자막", due: "2026-11-05" }, { id: logan, part: "화면", due: "2026-11-05" }]);
  assert.deepEqual(first.told, [yuth, logan]);
  const done = markReviewed(first.list, yuth, true, "2026-11-04T01:00:00Z");
  const again = setReviewers(done, [{ id: yuth, part: "자막", due: "2026-11-05" }, { id: logan, part: "화면", due: "2026-11-06" }]);
  assert.equal(again.list[0].doneAt, "2026-11-04T01:00:00Z");
  assert.deepEqual(again.told, [logan], "a moved date is told again; an unchanged finished part is not");
  assert.equal(markReviewed(again.list, "33333333-3333-4333-8333-333333333333", true, "x"), null, "only a named reviewer marks 검토 끝");
  assert.equal(markReviewed(again.list, yuth, false, "x")[0].doneAt, undefined, "다시 열기");
});

test("reminders: from the date on, only the unfinished, and nobody taken off the list", () => {
  const list = [{ id: yuth, part: "자막", due: "2026-11-05", doneAt: "2026-11-05T02:00:00Z" }, { id: logan, part: "화면", due: "2026-11-05" }, { id: logan, part: "소리", due: "" }];
  assert.deepEqual(dueReviewers(list, "2026-11-04"), []);
  assert.deepEqual(dueReviewers(list, "2026-11-05"), [logan]);
  assert.deepEqual(dueReviewers(list.filter(row => row.id !== logan), "2026-11-09"), []);
  assert.equal(kstDay("2026-11-04T15:30:00Z"), "2026-11-05", "the day is Korea's");
});

test("assigning never confirms, and the hourly job reminds once a day per person", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const stages = await read("lib/server/youtube-process-stages.ts");
  const set = stages.slice(stages.indexOf("export async function setYoutubeReviewers"), stages.indexOf("/** Every project with its dates"));
  assert.doesNotMatch(set, /actOnGate|confirmYoutubeGate|applyGateAction|saveProject/);
  const process = await read("lib/server/youtube-process.ts");
  assert.match(process, /review-due:\$\{row\.parent_id\}:\$\{today\}/);
  assert.match(await read("app/api/v1/content/youtube/cron/route.ts"), /remindReviewers\(\)/);
});
