import assert from "node:assert/strict";
import test from "node:test";
import { findPage, findStage, NAV_STAGES, searchNavigation, ACCOUNT_PAGE } from "../lib/navigation.ts";
import {RETIRED_ROUTES,retiredRoute} from "../lib/final-routes.ts";

const cases = [
  ["/content/automation", "최종 점검", "automation", "/automation/review"],
  ["/content/review", "최종 점검", "automation", "/automation/review"],
  ["/content/calendar", "발행·업로드", "content", "/content/publishing"],
];

test("legacy content routes point to their separate YouTube and automation sections", () => {
  for (const [pathname,label,stage,navHref] of cases) {
    assert.equal(findStage(pathname).id, stage);
    assert.equal(findPage(pathname).label, label);
    assert.equal(findPage(pathname).navHref, navHref);
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
    knowledge: ["/knowledge", "/knowledge/search", "/knowledge/review", "/knowledge/graph"],
    team: ["/home/decisions", "/organization/meetings", "/organization/tasks", "/organization/schedule", "/organization/leave", "/organization/members"],
    development: ["/knowledge/development", "/organization/agents"],
    settings: ["/settings/connections", "/settings/access", "/settings/audit", "/settings/company"],
  };
  assert.equal(NAV_STAGES.length, 8);
  assert.ok(NAV_STAGES.every(stage => stage.label.replaceAll(" ", "").length <= 6));
  assert.equal(findStage("/content/comments").id, "automation");
  assert.equal(findPage("/content/comments").processNumber, undefined);
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
  for (const [oldName, newName] of [["오늘 현황","내 할 일"],["주제 찾기","주제·기획"],["유튜브 발행","발행·업로드"],["문서 작업공간","문서 홈"],["지식 검색","문서 찾기"],["개발 관리","수정 요청"],["채널 연결","내 계정"],["감사 로그","변경 기록"]]) {
    assert.ok(searchNavigation(oldName).some(page => page.label === newName), oldName);
    assert.ok(searchNavigation(newName).some(page => page.label === newName), newName);
  }
});

test('company documents rebuild only their own group while all other menu counts remain unchanged',()=>{
  assert.deepEqual(NAV_STAGES.map(stage=>stage.pages.length),[1,7,9,10,4,7,3,4]);
  assert.equal(NAV_STAGES.find(stage=>stage.id==='finance').requiresFinance,true);
  assert.equal(searchNavigation('재무',false).some(page=>page.href.startsWith('/finance/')),false);
  assert.equal(searchNavigation('재무',true).filter(page=>page.href.startsWith('/finance/')).length,7);
  assert.ok(!NAV_STAGES.some(stage=>stage.pages.some(page=>page.href===ACCOUNT_PAGE.href)));
  assert.equal(findPage(ACCOUNT_PAGE.href).label,'내 계정');
  assert.deepEqual(NAV_STAGES[1].pages.map(page=>page.processNumber),[1,2,3,4,5,6,7]);
  assert.equal(findPage('/knowledge/development?tab=history').label,'업데이트 내역');
  assert.equal(findPage('/knowledge/development?tab=updates').label,'업데이트 내역');
});
test('ten approved retired menus get a data-preserved redirect',()=>{
  assert.equal(Object.keys(RETIRED_ROUTES).length,10);
  for(const [path,name] of Object.entries(RETIRED_ROUTES)){
    assert.equal(new URL(retiredRoute(path),'https://example.test').searchParams.get('moved'),name);
    assert.ok(!NAV_STAGES.some(stage=>stage.pages.some(page=>page.href===path)));
  }
  assert.equal(retiredRoute('/organization/tasks'),null);
  assert.equal(retiredRoute('/performance/ads-other'),null);
});
