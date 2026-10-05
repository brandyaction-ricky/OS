import { expect, test } from "@playwright/test";

test("empty development requests do not render a duplicate inbox panel and project links are editable", async ({ page }) => {
  await page.goto("/knowledge/development?tab=requests&project=preview-os-project");
  await expect(page.locator(".dev-no-results")).toBeVisible();
  await expect(page.locator(".dev-inbox-layout")).toHaveCount(0);

  await page.getByRole("button", { name: "프로젝트 추가" }).click();
  await expect(page.getByRole("textbox", { name: "Supabase 프로젝트 링크" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Vercel 프로젝트 링크" })).toBeVisible();
});

test("audit and company empty states are centered and settings cards have full-width headers", async ({ page }) => {
  await page.goto("/settings/audit");
  await expect(page.locator(".audit-panel > .empty-state")).toBeVisible();
  expect(await page.locator(".audit-panel > .empty-state").evaluate((element) => getComputedStyle(element).placeItems)).toBe("center");

  await page.goto("/settings/company");
  await expect(page.locator(".commerce-admin-links > .empty-state")).toBeVisible();
  expect(await page.locator(".commerce-admin-links > .empty-state").evaluate((element) => getComputedStyle(element).textAlign)).toBe("center");
  for (const selector of [".generation-settings", ".meeting-term-settings", ".category-grid"]) {
    const card = page.locator(selector);
    const header = card.locator(":scope > .panel-header, :scope > h2").first();
    await expect(header).toBeVisible();
    const cardBox = await card.boundingBox();
    const headerBox = await header.boundingBox();
    expect(cardBox && headerBox && Math.abs(cardBox.x - headerBox.x) < 2).toBeTruthy();
  }
});
