import assert from "node:assert/strict";
import test from "node:test";
import { findPage, findStage } from "../lib/navigation.ts";

const cases = [
  ["/content/automation", "멀티채널 자동화"],
  ["/content/review", "검토·발행 대기목록"],
  ["/content/calendar", "발행 캘린더"],
];

test("secondary content routes keep the content shell and publishing navigation active", () => {
  for (const [pathname, label] of cases) {
    assert.equal(findStage(pathname).id, "content");
    assert.equal(findPage(pathname).label, label);
    assert.equal(findPage(pathname).navHref, "/content/publishing");
  }
});

test("secondary content route matching does not capture similarly prefixed pages", () => {
  assert.equal(findStage("/content/calendar-extra").id, "home");
  assert.equal(findPage("/content/calendar-extra").label, "오늘 현황");
});
