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

test("empty revenue and advertising values use em dashes instead of artificial zeroes", async ({ page }) => {
  await page.goto("/home?view=management");
  await expect(page.locator(".revenue-band")).toContainText("주문 연결 대기");
  await expect(page.locator(".revenue-band")).not.toContainText("0만원");
  await page.goto("/performance/revenue");
  await expect(page.getByText("선택 기간 매출 0건 기준 · 주문 연결 대기", { exact: true })).toBeVisible();
  await expect(page.locator(".metric-value").first()).toHaveText("—");
  await page.goto("/performance/ads");
  const roas = page.locator(".metric-card").filter({ hasText: "ROAS" });
  await expect(roas.locator(".metric-value")).toHaveText("—");
  await expect(page.locator(".metric-grid")).not.toContainText("0.00배");
  await page.goto("/performance/connections");
  await expect(page.getByRole("heading", { name: "데이터 연결", exact: true })).toBeVisible();
  await expect(page.getByText("주문 연결 대기", { exact: true })).toBeVisible();
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
      await page.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`), fullPage: true });
    }
  });
}
