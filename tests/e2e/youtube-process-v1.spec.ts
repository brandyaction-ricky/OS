import { expect, test } from "@playwright/test";

// 유튜브 공정 v1 (T1): menu, 대표 메뉴 and the seven screens. Runs only with YOUTUBE_V1_ENABLED=true.
test.describe("유튜브 공정 v1 smoke", () => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Only runs when the YouTube process v1 flag is enabled.");
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
  });

  test("the YouTube menu becomes the v1 pages with 대표 메뉴 on top, and existing screens still open", async ({ page }) => {
    await page.goto("/content/projects");
    await expect(page.locator("#nav-content a.page-link")).toHaveText(["프로젝트", "기획", "제작", "최종 검수", "업로드", "쇼츠", "스케줄"]);
    await expect(page.locator("#nav-ceo a.page-link")).toHaveText(["컨펌"]);
    await page.getByRole("navigation", { name: "기존 화면" }).getByRole("link", { name: "3. 영상 제작" }).click();
    await expect(page).toHaveURL(/\/content\/video$/);
    await expect(page.getByRole("heading", { name: "영상 제작", level: 1 })).toBeVisible();
    await page.goto("/content/confirm");
    await expect(page.locator(".breadcrumbs")).toContainText("대표 메뉴");
  });

  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    test(`${width}px ${theme} keeps every v1 screen within the viewport`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const [name, url, heading] of [
        ["projects", "/content/projects", "프로젝트"],
        ["plan", "/content/plan?project=demo&view=topic", "기획"],
        ["make", "/content/make?project=demo", "제작"],
        ["final-check", "/content/final-check?project=demo&tab=video", "최종 검수"],
        ["upload", "/content/upload?project=demo", "업로드"],
        ["schedule", "/content/schedule?mode=month", "스케줄"],
        ["confirm", "/content/confirm?tab=wait", "컨펌"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator("section.yp.ui-v2")).toBeVisible();
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}px ${theme}`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${theme}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
});
