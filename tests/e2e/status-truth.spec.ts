import { expect, test } from "@playwright/test";

test("unified status keeps old URLs and explains unverified demo evidence", async ({ page, request }) => {
  for (const path of ["/settings/connections", "/settings/monitoring", "/settings/channels"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "작동 상태", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("작동 상태 | 브랜디 OS");
    await expect(page.locator(".page-link").filter({ hasText: "작동 상태" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "작동 상태 탭" })).toBeVisible();
  }
  await page.getByRole("link", { name: "연결 상태", exact: true }).click();
  await expect(page.getByText("데모 모드 · 실제 연결·이력·담당자는 확인하지 않습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 테스트", exact: true }).first()).toBeDisabled();
  const denied = await request.post("/api/v1/connections", { data: { service: "database" } });
  expect(denied.status()).toBe(401);
  const health = await (await request.get("/api/v1/health")).json();
  expect(health.checks.find((check: { id: string }) => check.id === "database")).toMatchObject({ status: "missing", lastOkAt: null });
});

test("retired finance views do not display placeholder revenue on home", async ({ page }) => {
  for (const route of ["/home?view=management", "/performance/revenue", "/performance/ads"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/확인할 일 \d+건/);
    await expect(page.locator(".revenue-band")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "오늘 콘텐츠 운영" })).toBeVisible();
  }
});

for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
  test(`status and data connections remain readable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto("/settings/connections");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const [path, name] of [["/settings/connections", "status"], ["/performance/connections", "data"]]) {
      if (name === "data") await page.goto(path);
      await expect(page.locator(".connection-evidence-grid")).toBeVisible();
      const overflow = await page.locator("main").evaluate(element => element.scrollWidth > element.clientWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`), fullPage: true, mask: [page.locator(".profile-trigger")], maskColor: "#777777" });
    }
  });
}
