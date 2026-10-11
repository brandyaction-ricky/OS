import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Team v1 visual smoke", () => {
  test.skip(process.env.TEAM_V1_ENABLED !== "true", "Only runs when the Team preview flag is enabled.");

  test("old decision links keep the selected record in the new Team log", async ({ page }) => {
    await page.goto("/home/decisions?record=11111111-1111-4111-8111-111111111111");
    await expect(page).toHaveURL(/\/organization\/meetings\?tab=decisions&record=11111111-1111-4111-8111-111111111111/);
    await expect(page.getByRole("heading", { name: "회의·결정", level: 1 })).toBeVisible();
  });

  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    test(`${width}px ${theme} keeps Team routes within the viewport`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const target = path.join(process.cwd(), "docs/review/team-menu-v1/screens");
      mkdirSync(target, { recursive: true });
      for (const [name, url, heading] of [
        ["meetings", "/organization/meetings", "회의·결정"],
        ["decisions", "/organization/meetings?tab=decisions", "회의·결정"],
        ["prep", "/organization/meetings?tab=prep", "회의·결정"],
        ["my-tasks", "/organization/tasks?view=my", "업무"],
        ["board", "/organization/tasks?view=board", "업무"],
        ["inbox", "/organization/tasks?view=inbox", "업무"],
        ["schedule", "/organization/schedule?view=month", "팀 일정"],
        ["people", "/organization/people", "팀 현황"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator(".tm-root")).toBeVisible();
        await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} at ${width}px ${theme}`).toBe(true);
        await page.screenshot({ path: path.join(target, `${name}-${width}-${theme}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
});
