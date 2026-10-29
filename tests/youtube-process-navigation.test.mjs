import assert from "node:assert/strict";
import test from "node:test";
import { findPage, findStage, NAV_STAGES } from "../lib/navigation.ts";
import { youtubeV1Enabled } from "../lib/youtube-process/gate.ts";
import { YOUTUBE_V1_CONFIRM_PAGE, YOUTUBE_V1_HREFS, YOUTUBE_V1_PAGES, YOUTUBE_V1_STEP_PAGES, youtubeV1Screen } from "../lib/youtube-process/navigation.ts";
import { YOUTUBE_V1_GUIDES } from "../lib/youtube-process/guides.ts";

test("the switch is off unless YOUTUBE_V1_ENABLED is exactly true", () => {
  assert.equal(youtubeV1Enabled({}), false);
  assert.equal(youtubeV1Enabled({ YOUTUBE_V1_ENABLED: "1" }), false);
  assert.equal(youtubeV1Enabled({ YOUTUBE_V1_ENABLED: "true" }), true);
});

test("v1 menu is 내 영상 · 스케줄 · 성과 (owner decision 2026-10-21) and 단축 링크 (2026-10-26); the steps sit under 내 영상; 컨펌 under 대표 메뉴", () => {
  assert.deepEqual(YOUTUBE_V1_PAGES.map(page => page.label), ["내 영상", "스케줄", "성과", "링크관리"]);
  assert.deepEqual(YOUTUBE_V1_STEP_PAGES.map(page => [page.href, page.navHref]), [["/content/plan", "/content/projects"], ["/content/make", "/content/projects"], ["/content/final-check", "/content/projects"], ["/content/upload", "/content/projects"], ["/content/shorts", "/content/projects"]]);
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

test("side menu by what is made (owner 2026-10-29, A안): 공통 + 롱폼 · 숏폼 · 광고 + 스레드 + 자동화 관리, same addresses", async () => {
  const { NAV_STAGES } = await import("../lib/navigation.ts");
  const { youtubeV1Stages, youtubeV1StageId, youtubeV1EntrySelected } = await import("../lib/youtube-process/navigation.ts");
  const stages = youtubeV1Stages(NAV_STAGES);
  const ids = stages.map(stage => stage.id);
  assert.deepEqual(ids.slice(0, 6), ["content", "yt-longform", "yt-short", "yt-ad", "threads", "automation"]);
  assert.deepEqual(stages.map(stage => stage.label).slice(0, 6), ["공통", "롱폼 유튜브", "숏폼 · 릴스", "광고", "스레드", "자동화 관리"]);
  assert.deepEqual(stages[0].pages.map(page => page.label), ["주제 찾기", "스케줄", "성과", "링크관리"]);
  const threads = stages.find(stage => stage.id === "threads");
  assert.equal(threads.pages[0].label, "스레드 글감 모으기", "레퍼런스 수집 says what it collects");
  assert.equal(threads.pages[0].href, "/automation/references");
  // Every old address is still in the menu exactly once (bookmarks, guides and per-address menu permissions keep working).
  const before = NAV_STAGES.filter(stage => stage.id === "automation").flatMap(stage => stage.pages.map(page => page.href)).sort();
  const after = stages.filter(stage => ["threads", "automation"].includes(stage.id)).flatMap(stage => stage.pages.map(page => page.href)).sort();
  assert.deepEqual(after, before);
  for (const stage of stages.slice(0, 4)) for (const page of stage.pages) assert.ok(!page.href.includes("?") || page.href.startsWith("/content/projects?"), page.href);
  const p = query => new URLSearchParams(query);
  assert.equal(youtubeV1StageId(stages, "/content/projects", p("platform=short"), "content"), "yt-short");
  assert.equal(youtubeV1StageId(stages, "/content/projects", p("view=discover&platform=short"), "content"), "content");
  assert.equal(youtubeV1StageId(stages, "/automation/threads", p(""), "automation"), "threads");
  assert.equal(youtubeV1StageId(stages, "/automation/requests", p(""), "automation"), "automation");
  assert.equal(youtubeV1StageId(stages, "/content/plan", p("id=x"), "content"), "content");
  assert.ok(youtubeV1EntrySelected("/content/projects?platform=ad", "/content/projects", p("platform=ad")));
  assert.ok(!youtubeV1EntrySelected("/content/projects?platform=ad", "/content/projects", p("platform=short")));
  assert.ok(youtubeV1EntrySelected("/content/projects?view=discover", "/content/projects", p("view=discover&platform=threads")));
});
