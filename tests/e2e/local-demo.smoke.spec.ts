import { expect, test } from "@playwright/test";

test("production workflow shows its content navigation and breadcrumb", async ({ page }) => {
  await page.goto("/content/automation");
  const breadcrumb = page.getByRole("navigation", { name: "현재 위치" });
  await expect(breadcrumb).toContainText("콘텐츠");
  await expect(breadcrumb).toContainText("제작 공정·파생");
  await expect(breadcrumb).not.toContainText("오늘 현황");
  await expect(page.getByRole("link", { name: "제작 공정·파생", exact: true })).toBeVisible();
});

test("local demo renders the application shell and health contract", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/home");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("이번 주 핵심만 모았습니다");
  await expect(page.getByText("데모 데이터", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "지식 찾기" })).toBeVisible();

  const healthResponse = await request.get("/api/v1/health");
  expect(healthResponse.status()).toBe(200);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "brandyaction-os",
    database: "missing",
    auth: "missing",
  });

  expect(consoleErrors).toEqual([]);
});
