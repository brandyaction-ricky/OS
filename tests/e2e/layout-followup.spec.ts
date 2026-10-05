import { expect, test } from "@playwright/test";

const routes = [
  "/content/scripts",
  "/content/shorts",
  "/content/publishing",
  "/automation/review",
  "/automation/templates",
  "/settings/connections",
  "/settings/audit",
  "/settings/company",
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

for (const width of [1280, 390]) {
  test(`requested layout follow-up screens fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 840 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${route.slice(1).replaceAll("/", "-")}-${width}.png`),
        mask: [page.locator(".profile-trigger")],
      });
    }
    expect(errors).toEqual([]);
  });
}

test("cardnews copy updates the preview and audit has no idle detail card", async ({ page }) => {
  await page.goto("/automation/templates");
  await page.getByRole("textbox", { name: "미리보기 제목" }).fill("검수용 카드 제목");
  await page.getByRole("textbox", { name: "미리보기 본문" }).fill("입력 문구가 미리보기에 반영됩니다.");
  await expect(page.locator(".automation-template-preview h2")).toHaveText("검수용 카드 제목");
  await expect(page.locator(".automation-template-preview p")).toHaveText("입력 문구가 미리보기에 반영됩니다.");
  await page.goto("/settings/audit");
  await expect(page.getByText("변경 내용을 확인하세요", { exact: true })).toHaveCount(0);
});
