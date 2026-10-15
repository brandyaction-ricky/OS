import assert from "node:assert/strict";
import test from "node:test";
import { findPage, findStage, NAV_STAGES } from "../lib/navigation.ts";
import { youtubeV1Enabled } from "../lib/youtube-process/gate.ts";
import { YOUTUBE_V1_CONFIRM_PAGE, YOUTUBE_V1_HREFS, YOUTUBE_V1_PAGES, youtubeV1Screen } from "../lib/youtube-process/navigation.ts";
import { YOUTUBE_V1_GUIDES } from "../lib/youtube-process/guides.ts";

test("the switch is off unless YOUTUBE_V1_ENABLED is exactly true", () => {
  assert.equal(youtubeV1Enabled({}), false);
  assert.equal(youtubeV1Enabled({ YOUTUBE_V1_ENABLED: "1" }), false);
  assert.equal(youtubeV1Enabled({ YOUTUBE_V1_ENABLED: "true" }), true);
});

test("v1 menu is seven pages in prototype order, plus 컨펌 under 대표 메뉴", () => {
  assert.deepEqual(YOUTUBE_V1_PAGES.map(page => page.label), ["프로젝트", "기획", "제작", "최종 검수", "업로드", "쇼츠", "스케줄"]);
  assert.deepEqual(YOUTUBE_V1_PAGES.map(page => page.href), ["/content/projects", "/content/plan", "/content/make", "/content/final-check", "/content/upload", "/content/shorts", "/content/schedule"]);
  assert.ok(YOUTUBE_V1_PAGES.every(page => page.processNumber === undefined), "no legacy process bar on v1 screens");
  assert.equal(findStage("/content/confirm").id, "ceo");
  assert.equal(findStage("/content/confirm").label, "대표 메뉴");
  assert.equal(findPage("/content/confirm?tab=wait").label, YOUTUBE_V1_CONFIRM_PAGE.label);
});

test("new routes resolve to their names inside the YouTube group; shorts keeps the existing screen", () => {
  assert.equal(findPage("/content/plan?project=p1&view=outline").label, "기획");
  assert.equal(findStage("/content/final-check?project=p1&tab=video").id, "content");
  assert.equal(youtubeV1Screen("/content/upload"), "upload");
  assert.equal(youtubeV1Screen("/content/shorts"), null);
  assert.equal(youtubeV1Screen("/content/topics"), null);
  assert.ok(!YOUTUBE_V1_HREFS.some(href => NAV_STAGES.some(stage => stage.pages.some(page => page.href === href))), "no new route shadows an existing one");
});

test("existing YouTube menu is untouched while the switch is off", () => {
  const content = NAV_STAGES.find(stage => stage.id === "content");
  assert.deepEqual(content.pages.map(page => page.href), ["/content/topics", "/content/scripts", "/content/video", "/content/packages", "/content/shorts", "/content/publishing", "/content/youtube", "/content/performance"]);
  assert.equal(findPage("/content/shorts").label, "숏폼 편집");
  assert.equal(findPage("/content/video").label, "영상 제작");
});

test("each v1 screen has a three-step guide whose next page exists", () => {
  assert.deepEqual(Object.keys(YOUTUBE_V1_GUIDES).sort(), [...YOUTUBE_V1_HREFS].sort());
  for (const [href, guide] of Object.entries(YOUTUBE_V1_GUIDES)) {
    assert.equal(guide.steps.length, 3, href);
    assert.notEqual(findPage(guide.next).label, "홈", `${href} → ${guide.next}`);
  }
});
