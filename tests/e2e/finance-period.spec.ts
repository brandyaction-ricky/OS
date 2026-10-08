import { expect, test } from "@playwright/test";

test("all-history date picker starts this month and keeps a chosen historical month", async ({ page }) => {
  await page.goto("/finance/sales?period=month&month=2026-09");
  const period = page.getByRole("group", { name: "조회 기간", exact: true });
  await period.getByRole("button", { name: "전체", exact: true }).click();
  await period.getByRole("button", { name: "기간 설정", exact: true }).click();
  const today = await period.getByLabel("종료일", { exact: true }).getAttribute("max");
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue(`${today!.slice(0, 7)}-01`);
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue(today!);
  await expect(page).toHaveURL(new RegExp(`from=${today!.slice(0, 7)}-01&to=${today}`));

  await period.getByRole("button", { name: "월별", exact: true }).click();
  await period.getByRole("combobox", { name: "월 선택" }).selectOption("2026-09");
  await period.getByRole("button", { name: "기간 설정", exact: true }).click();
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue("2026-09-01");
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue("2026-09-30");
  await period.getByRole("button", { name: "이번 달", exact: true }).click();
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue(`${today!.slice(0, 7)}-01`);
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue(today!);
  await expect(page).toHaveURL(new RegExp(`period=custom&month=${today!.slice(0, 7)}`));
});

test("historical custom URLs stay intact until the current-month shortcut is clicked", async ({ page }) => {
  await page.goto("/finance/sales?period=custom&month=2026-09&from=2026-09-01&to=2026-09-30&tab=toss");
  const period = page.getByRole("group", { name: "조회 기간", exact: true });
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue("2026-09-01");
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue("2026-09-30");
  await period.getByRole("button", { name: "이번 달", exact: true }).click();
  const today = await period.getByLabel("종료일", { exact: true }).getAttribute("max");
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue(`${today!.slice(0, 7)}-01`);
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue(today!);
  await page.reload();
  await expect(period.getByLabel("시작일", { exact: true })).toHaveValue(`${today!.slice(0, 7)}-01`);
  await expect(period.getByLabel("종료일", { exact: true })).toHaveValue(today!);
});
