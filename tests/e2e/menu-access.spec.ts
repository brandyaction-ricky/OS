import { expect, test } from "@playwright/test";

test("menu settings persist, cancel discards changes, and reset restores defaults", async ({ page }) => {
  await page.goto("/settings/access");
  const trigger = page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "가상 마케터 권한 설정", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "내 할 일 항상 허용" })).toBeDisabled();
  await expect(dialog.getByRole("group", { name: /^재무관리/ })).toHaveCount(0);
  await dialog.getByRole("radio", { name: /메뉴 직접 선택/ }).check();
  await dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  await expect(dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true }).check();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await trigger.click();
  await expect(dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "기본 권한으로", exact: true }).click();
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  await page.reload();
  await trigger.click();
  await expect(dialog.getByRole("radio", { name: /기본 권한 사용/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true })).toBeChecked();
});

test("mobile administrator settings are read-only and keep keyboard focus in the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/access");
  const trigger = page.getByRole("button", { name: "가상 관리자 권한 설정", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "가상 관리자 권한 설정", exact: true });
  await expect(dialog.getByRole("button", { name: "권한 저장", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: "매출내역", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  const close = dialog.getByRole("button", { name: "권한 설정 닫기", exact: true });
  await expect(close).toBeFocused();
  await close.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "닫기", exact: true }).press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});
