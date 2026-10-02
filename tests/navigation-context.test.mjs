import assert from "node:assert/strict";
import test from "node:test";
import { findPage, findStage, NAV_STAGES, searchNavigation } from "../lib/navigation.ts";

const cases = [
  ["/content/automation", "멀티채널 자동화"],
  ["/content/review", "검토·발행 대기목록"],
  ["/content/calendar", "발행 캘린더"],
];

test("secondary content routes keep the content shell and publishing navigation active", () => {
  for (const [pathname] of cases) {
    assert.equal(findStage(pathname).id, "content");
    assert.equal(findPage(pathname).label, "발행 일정");
    assert.equal(findPage(pathname).navHref, "/content/publishing");
  }
});

test("secondary content route matching does not capture similarly prefixed pages", () => {
  assert.equal(findStage("/content/calendar-extra").id, "home");
  assert.equal(findPage("/content/calendar-extra").label, "내 할 일");
});

test("all legacy pages resolve to their new group and one authoritative name", () => {
  const groups = {
    home: ["/home"],
    content: ["/content/topics", "/content/scripts", "/content/packages", "/content/shorts", "/content/publishing", "/content/youtube", "/content/performance"],
    knowledge: ["/knowledge", "/knowledge/search", "/knowledge/review", "/knowledge/skills", "/knowledge/graph"],
    performance: ["/home/goals", "/home/reports", "/performance/overview", "/performance/weekly-kpi", "/performance/revenue", "/performance/customers", "/performance/funnels", "/performance/ads", "/performance/connections"],
    team: ["/home/decisions", "/organization/meetings", "/organization/tasks", "/organization/schedule", "/organization/leave", "/organization/members", "/organization/finance"],
    development: ["/knowledge/development", "/organization/agents"],
    settings: ["/settings/connections", "/settings/access", "/settings/audit", "/settings/company"],
  };
  assert.equal(NAV_STAGES.length, 7);
  assert.ok(NAV_STAGES.every(stage => stage.label.replaceAll(" ", "").length <= 5));
  for (const [group, paths] of Object.entries(groups)) for (const path of paths) {
    assert.equal(findStage(path).id, group, path);
    assert.equal(findPage(path).href, path);
    assert.equal(findStage(`${path}?fixture=1#section`).id, group);
  }
  for (const path of ["/settings/monitoring", "/settings/channels"]) {
    assert.equal(findPage(path).label, "작동 상태");assert.equal(findPage(path).navHref, "/settings/connections");
  }
  assert.equal(findStage("/knowledge/development/request").id, "development");
  assert.notEqual(findPage("/knowledge/development-extra").label, "수정 요청");
});
test("command palette finds both new labels and former menu labels", () => {
  for (const [oldName, newName] of [["오늘 현황","내 할 일"],["주제·기획","주제 찾기"],["발행·업로드","발행 일정"],["문서 작업공간","전체 문서"],["지식 검색","문서 찾기"],["개발 관리","수정 요청"],["성과 통합 현황","회사 현황"],["감사 로그","변경 기록"]]) {
    assert.ok(searchNavigation(oldName).some(page => page.label === newName), oldName);
    assert.ok(searchNavigation(newName).some(page => page.label === newName), newName);
  }
});
