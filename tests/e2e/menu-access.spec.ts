import { expect, test } from "@playwright/test";

test("menu settings persist, cancel discards changes, and reset restores defaults", async ({ page }) => {
  await page.goto("/settings/access");
  const trigger = page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "가상 마케터 권한 설정", exact: true });
  await expect(dialog.getByRole("checkbox", { name: "내 할 일 항상 허용" })).toBeDisabled();
  const finance = dialog.getByRole("group", { name: /^재무관리/ });
  await expect(finance).toBeVisible();
  await expect(finance.getByRole("checkbox", { name: "매출내역", exact: true })).toBeDisabled();
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

test("finance menus stay discoverable but locked without existing finance access", async ({ page }) => {
  await page.goto("/settings/access");
  await page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /메뉴 직접 선택/ }).check();
  const finance = dialog.getByRole("group", { name: /^재무관리/ });
  await expect(finance).toContainText("0/7");
  await expect(finance).toContainText("권한 필요");
  for (const label of ["그룹 전체 선택", "개요", "매출내역", "정산입금", "통장 내역", "카드지출", "정기 결제", "예산 관리"]) {
    await expect(finance.getByRole("checkbox", { name: label, exact: true })).toBeDisabled();
    await expect(finance.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
  }
  await expect(finance.getByRole("link", { name: "구성원 권한 관리 →", exact: true })).toHaveAttribute("href", "/organization/members");
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("brandy-os-demo-menu-access-v1") ?? "[]"));
  expect(stored[0].allowed_menus.some((href: string) => href.startsWith("/finance/"))).toBe(false);
});

test("eligible finance accounts can select, persist and reset individual finance menus", async ({ page }) => {
  await page.goto("/settings/access");
  const trigger = page.getByRole("button", { name: "가상 회계 담당 권한 설정", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const finance = dialog.getByRole("group", { name: /^재무관리/ });
  await expect(finance).toContainText("7/7");
  await dialog.getByRole("radio", { name: /메뉴 직접 선택/ }).check();
  await expect(finance.getByRole("checkbox", { name: "카드지출", exact: true })).toBeEnabled();
  await finance.getByRole("checkbox", { name: "그룹 전체 선택", exact: true }).uncheck();
  await finance.getByRole("checkbox", { name: "카드지출", exact: true }).check();
  await expect(finance).toContainText("1/7");
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  await page.reload();
  await trigger.click();
  await expect(finance.getByRole("checkbox", { name: "카드지출", exact: true })).toBeChecked();
  await expect(finance.getByRole("checkbox", { name: "매출내역", exact: true })).not.toBeChecked();
  await expect(finance).toContainText("1/7");
  await dialog.getByRole("button", { name: "기본 권한으로", exact: true }).click();
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  await page.reload();
  await trigger.click();
  await expect(dialog.getByRole("radio", { name: /기본 권한 사용/ })).toBeChecked();
  await expect(finance).toContainText("7/7");
});

test("revoked finance eligibility does not re-save stale finance menu selections", async ({ page }) => {
  await page.goto("/settings/access");
  await page.evaluate(() => localStorage.setItem("brandy-os-demo-menu-access-v1", JSON.stringify([{ member_id: "demo-marketer", allowed_menus: ["/home", "/finance/cards", "/content/topics"], version: 2 }])));
  await page.reload();
  await page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "카드지출", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "주제·기획", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "권한 저장", exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("brandy-os-demo-menu-access-v1") ?? "[]"));
  expect(stored[0].allowed_menus).toEqual(["/home", "/content/topics"]);
});

test("mobile finance guidance opens existing member management without saving draft menus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/access");
  await page.getByRole("button", { name: "가상 마케터 권한 설정", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /메뉴 직접 선택/ }).check();
  await dialog.getByRole("checkbox", { name: "원고·스크립트", exact: true }).uncheck();
  await expect(dialog.getByRole("checkbox", { name: "매출내역", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("link", { name: "구성원 권한 관리 →", exact: true }).click();
  await expect(page).toHaveURL(/\/organization\/members$/);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("brandy-os-demo-menu-access-v1"))).toBeNull();
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
