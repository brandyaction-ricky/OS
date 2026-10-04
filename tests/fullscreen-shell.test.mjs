import assert from "node:assert/strict";
import test from "node:test";
import { contentsAutoLinks, CONTENTS_AUTO_SCREENS } from "../lib/contents-auto-links.ts";
import { fullscreenScreen, FULLSCREEN_ROUTES } from "../lib/fullscreen-screen.ts";

test("external app links are deployment-configured, not invented prototype URLs", () => {
  assert.equal(CONTENTS_AUTO_SCREENS.length, 8);
  for (const value of [undefined, "", "broken", "null", "[]"]) assert.deepEqual(contentsAutoLinks(value), {});
  assert.deepEqual(contentsAutoLinks(JSON.stringify({ dashboard: "https://example.test/dashboard", review: "https://example.test/review?filter=pending" })), {
    dashboard: "https://example.test/dashboard", review: "https://example.test/review?filter=pending",
  });
  for (const value of ["javascript:alert(1)", "//example.test", "/ca/s-02-dashboard.html", "http://example.test", "https://user:pass@example.test", 123]) {
    assert.deepEqual(contentsAutoLinks(JSON.stringify({dashboard: value})), {});
  }
  assert.deepEqual(contentsAutoLinks('{"unknown":"https://example.test"}'), {});
});

test("all full-screen routes have explicit styling without changing their URLs", () => {
  assert.equal(Object.keys(FULLSCREEN_ROUTES).length, 31);
  assert.equal(fullscreenScreen("/knowledge", "canon"), "canon");
  assert.equal(fullscreenScreen("/knowledge/development", "updates"), "updates");
  assert.equal(fullscreenScreen("/knowledge/development", "history"), "updates");
  assert.equal(fullscreenScreen("/home/decisions"), "decisions");
  assert.equal(fullscreenScreen("/organization/leave"), "leave");
  assert.equal(fullscreenScreen("/organization/schedule", "leave"), "leave");
  assert.equal(fullscreenScreen("/content/comments"), "comments");
  assert.equal(fullscreenScreen("/settings/channels"), "channels");
  assert.equal(fullscreenScreen("/unknown"), undefined);
});
