import test from "node:test";
import assert from "node:assert/strict";
import { commerceAdminUrlError } from "../lib/commerce-admin-url.ts";
import { isTestContent } from "../lib/youtube-process/test-content.ts";
import { searchNavigation } from "../lib/navigation.ts";

test("admin URLs reject insecure, credential-bearing and public video destinations", () => {
  for (const url of ["", "http://admin.example.test", "javascript:alert(1)", "https://user:secret@admin.example.test", "https://m.youtube.com/watch?v=test", "https://youtu.be/test", "https://www.instagram.com/p/test"]) assert.ok(commerceAdminUrlError(url));
  assert.equal(commerceAdminUrlError("https://admin.example.test/orders"), null);
});
test("only explicit test prefixes hide content; ordinary titles and copies remain visible", () => {
  for (const title of ["[QA 테스트] 샘플", "[QA확인] 검증", "[TEST] sample", "QA테스트: example"]) assert.equal(isTestContent(title), true);
  for (const title of ["성격 테스트 활용법", "업무 QA를 개선하기", "정상 콘텐츠 (복사)", "[예시] 주제"]) assert.equal(isTestContent(title), false);
});
test("search uses current navigation and still obeys permission checks", () => {
  const stages = [{id:"common",label:"공통",pages:[{label:"스케줄",href:"/content/schedule"},{label:"주제 찾기",href:"/content/projects?view=discover"}]}];
  assert.ok(searchNavigation("스케줄", false, () => true, false, stages).some(item => item.href === "/content/schedule"));
  assert.equal(searchNavigation("스케줄", false, () => false, false, stages).length, 0);
  assert.equal(searchNavigation("삭제된 메뉴", false, () => true, false, stages).length, 0);
});
