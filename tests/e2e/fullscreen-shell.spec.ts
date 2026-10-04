import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("brandy-os-menu-guide-final", "seen");
    localStorage.setItem("brandy-knowledge-focus", "false");
  });
});

test("seven YouTube steps keep content selection; comments have a separate group", async ({ page }) => {
  await page.goto("/content/topics");
  const process = page.getByRole("navigation", { name: "콘텐츠 공정 순서" });
  await expect(process.getByRole("link")).toHaveCount(7);
  await page.getByLabel("작업 중인 영상 선택").selectOption("demo-final-topic");
  await process.getByRole("link", { name: "7. 영상 성과" }).click();
  await expect(page).toHaveURL(/topic=demo-final-topic/);
  await expect(page.getByLabel("작업 중인 영상 선택")).toHaveValue("demo-final-topic");
  await page.goto("/content/comments");
  await expect(page.locator(".breadcrumbs")).toContainText("콘텐츠 자동화");
  await expect(page.getByRole("navigation", { name: "콘텐츠 공정 순서" })).toHaveCount(0);
  await expect(page.locator(".external-app-link[aria-disabled=true]")).toHaveCount(8);
  await expect(page.locator('.external-app-link[href*="ca/"]')).toHaveCount(0);
});

test("quick record opens the request drawer without leaving the current screen", async ({ page }) => {
  await page.goto("/organization/tasks");
  await page.getByRole("button", { name: "빠른 기록", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "수정 요청" })).toBeVisible();
  await expect(page).toHaveURL(/\/organization\/tasks$/);
});

for (const theme of ["light", "dark"]) {
  test(`canonical shell measurements at 1280px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.addInitScript(theme => localStorage.setItem("brandy-os-theme", theme), theme);
    await page.goto("/content/topics");
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("주제·기획");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".topbar")).toHaveCSS("height", "53px");
    await expect(page.locator(".page-sidebar")).toHaveCSS("width", "240px");
    await expect(page.locator(".process-bar")).toHaveCSS("height", "47px");
    await expect(page.locator(".quick-add")).toHaveCSS("height", "28px");
    await expect(page.locator(".guide-no").first()).toHaveCSS("font-size", "10.5px");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`shell-${theme}.png`),mask:[page.locator(".profile-trigger")]});
    await page.getByRole("button", { name: "사이드바 접기" }).click();
    await expect(page.locator(".page-sidebar")).toHaveCSS("width", "64px");
    await page.getByRole("button", { name: "사이드바 펼치기" }).click();
    await expect(page.locator(".page-sidebar")).toHaveCSS("width", "240px");
  });
}

test("narrow shell keeps navigation and quick actions reachable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/content/topics");
  await expect(page.locator(".topbar")).toHaveCSS("height", "48px");
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.getByRole("button", { name: "메뉴 닫기" })).toBeFocused();
  await page.getByRole("link", { name: "영상 성과", exact: true }).click();
  await expect(page.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("shell-mobile.png"),mask:[page.locator(".profile-trigger")]});
});
