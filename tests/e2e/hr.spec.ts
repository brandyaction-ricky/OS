import { expect, test } from "@playwright/test";

// Run against an isolated, credential-free HR demo server only.
test.skip(process.env.HR_E2E_DEMO !== "true", "Requires an explicitly selected HR demo server");
test.beforeEach(async ({ page }) => {
  await page.goto("/hr/leave");
  await expect(page.getByText(/인사 체험 모드 · 가상 자료/)).toBeVisible();
});

test("approval, cancellation and manual adjustment update the same balance", async ({ page }) => {
  const row = page.getByRole("row").filter({ hasText: "직원 A" });
  await row.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("14일");
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await row.getByRole("button", { name: "상세", exact: true }).click();
  await page.getByRole("button", { name: "휴가 취소", exact: true }).click();
  await page.getByRole("button", { name: "취소 확인", exact: true }).click();
  await expect(row).toContainText("취소");
  await page.getByRole("navigation", { name: "인사·노무 메뉴" }).getByRole("link", { name: "연차 관리", exact: true }).click();
  await expect(row).toContainText("16일");
  await row.getByRole("button", { name: "원장 보기" }).click();
  await page.getByRole("button", { name: "＋ 수동 조정" }).click();
  await page.getByRole("spinbutton", { name: /조정 일수/ }).fill("-0.5");
  await page.getByRole("textbox", { name: "사유", exact: true }).fill("가상 QA 조정");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect(row).toContainText("15.5일");
});

test("calendar switches between bounded month and week views and filters people", async ({ page }) => {
  await page.getByRole("link", { name: "휴가 캘린더", exact: true }).click();
  await expect(page.getByRole("region", { name: "월간 휴가 캘린더" }).locator("time")).toHaveCount(42);
  await page.getByRole("button", { name: "주", exact: true }).click();
  await expect(page.getByRole("region", { name: "주간 휴가 캘린더" }).locator("time")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "주간 휴가 캘린더" })).toContainText("쉬는 날");
  await page.getByRole("combobox", { name: "캘린더 사람" }).selectOption({ label: "직원 A" });
  await expect(page.getByRole("button", { name: "직원 D · 오전 반차" })).toHaveCount(0);
});

test("mobile drawer has no page overflow and Escape restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole("button", { name: "＋ 휴가 입력", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "입력 창 닫기" }).press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});
