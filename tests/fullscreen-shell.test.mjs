import assert from "node:assert/strict";
import test from "node:test";
import { fullscreenScreen, FULLSCREEN_ROUTES } from "../lib/fullscreen-screen.ts";
import { NAV_STAGES } from "../lib/navigation.ts";

test("content automation is implemented as internal OS routes", () => {
  const automation = NAV_STAGES.find((stage) => stage.id === "automation");
  assert.equal(automation?.pages.length, 9);
  assert.equal(automation?.pages.filter((page) => page.href.startsWith("/automation/")).length, 8);
  assert.equal(automation?.pages.at(-1)?.href, "/content/comments");
  for (const page of automation?.pages ?? []) assert.equal(page.href.startsWith("http"), false);
});

test("all full-screen routes have explicit styling without changing their URLs", () => {
  assert.equal(Object.keys(FULLSCREEN_ROUTES).filter(path=>!path.startsWith("/hr")).length, 46);
  for (const name of ["overview", "sales", "settlements", "bank", "cards", "recurring", "budget"]) {
    assert.equal(fullscreenScreen("/finance/" + name), "finance-" + name);
  }
  assert.equal(fullscreenScreen("/knowledge", "canon"), "canon");
  assert.equal(fullscreenScreen("/knowledge/development", "updates"), "updates");
  assert.equal(fullscreenScreen("/knowledge/development", "history"), "updates");
  assert.equal(fullscreenScreen("/home/decisions"), "decisions");
  assert.equal(fullscreenScreen("/organization/leave"), "leave");
  assert.equal(fullscreenScreen("/organization/schedule", "leave"), "leave");
  assert.equal(fullscreenScreen("/content/comments"), "comments");
  assert.equal(fullscreenScreen("/automation/dashboard"), "automation-dashboard");
  assert.equal(fullscreenScreen("/automation/settings"), "automation-settings");
  assert.equal(fullscreenScreen("/settings/channels"), "channels");
  assert.equal(fullscreenScreen("/unknown"), undefined);
});

test("HR screens are scoped without replacing existing destinations",()=>{assert.equal(fullscreenScreen('/hr/employees'),'hr-employees');assert.equal(fullscreenScreen('/hr/employees/person'),'hr-person');assert.equal(fullscreenScreen('/hr/my-leave'),'hr-self');});
