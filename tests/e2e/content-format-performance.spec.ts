import { expect, test } from "@playwright/test";

test("콘텐츠 성과에서 포맷을 바꾸고 새로 고쳐도 같은 형식과 기간을 연다", async ({ page }) => {
  test.slow();
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "콘텐츠 제작 v1 화면");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
  await page.goto("/content/performance?period=30d");
  const formats = page.getByRole("navigation", { name: "콘텐츠 형식" });
  await expect(page.getByRole("heading", { name: "콘텐츠 성과", exact: true })).toBeVisible();
  await formats.getByRole("link", { name: "카드뉴스" }).click();
  await expect(page.getByRole("table", { name: "경과일별 성과 비교" })).toContainText("인스타");
  await expect(page.getByRole("table", { name: "경과일별 성과 비교" })).not.toContainText("Threads");
  await formats.getByRole("link", { name: "스레드" }).click();
  await expect(page).toHaveURL(/format=threads/);
  await page.reload();
  await expect(formats.getByRole("link", { name: "스레드" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table", { name: "경과일별 성과 비교" })).toContainText("Threads");
  await expect(page).toHaveURL(/period=30d/);
  await formats.getByRole("link", { name: "광고" }).click();
  await expect(page.getByText(/지난 광고 성과/).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(formats.getByRole("link", { name: "숏폼" })).toBeInViewport();
  await formats.getByRole("link", { name: "숏폼" }).click();
  await expect(page.getByRole("button", { name: "성과 기록", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
