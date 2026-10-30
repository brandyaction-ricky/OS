import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.clock.install({ time: new Date("2026-10-30T03:00:00Z") });
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

test("undated work can be dragged, selected by keyboard, edited, cancelled and cleared", async ({ page }) => {
  await page.goto("/content/schedule");
  const list = page.getByRole("complementary", { name: "날짜 없는 콘텐츠" });
  const rows = list.locator(".yp-undated-item");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count(), name = (await rows.first().getAttribute("aria-label"))!.replace(" 업로드 날짜 선택", "");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await rows.first().dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.locator('[data-date="2026-10-30"]').dispatchEvent("drop", { dataTransfer: transfer });
  await expect(rows).toHaveCount(count - 1);
  const event = page.locator('[data-date="2026-10-30"]').getByRole("button", { name: `${name} · 업로드 예상일`, exact: true });
  await expect(event).toBeVisible();
  await event.click();
  const dialog = page.getByRole("dialog", { name: /일정 바꾸기/ });
  await expect(dialog.getByLabel("업로드 예상일")).toHaveValue("2026-10-30");
  await dialog.getByLabel("업로드 예상일").fill("2026-10-31");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(event).toBeVisible();
  await event.click();
  await dialog.getByLabel("편집 완료일").fill("2026-10-30");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  const rejected = await page.evaluateHandle(() => new DataTransfer());
  await event.dispatchEvent("dragstart", { dataTransfer: rejected });
  await page.locator('[data-date="2026-10-29"]').dispatchEvent("drop", { dataTransfer: rejected });
  await expect(page.locator(".yp-schedule").getByRole("alert")).toContainText("업로드 일정은 편집 완료 일정보다 앞으로 옮길 수 없어요");
  await expect(event).toBeVisible();
  await event.click();
  await dialog.getByLabel("업로드 예상일").fill("");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(rows).toHaveCount(count);
  await list.getByRole("button", { name: `${name} 업로드 날짜 선택`, exact: true }).press("Enter");
  await page.getByRole("button", { name: "2026-10-31 업로드 날짜로 선택", exact: true }).press("Enter");
  await expect(page.locator('[data-date="2026-10-31"]').getByRole("button", { name: `${name} · 업로드 예상일`, exact: true })).toBeVisible();
});

test("month/week navigation, today, filters and confirmation visibility retain their behavior", async ({ page }) => {
  await page.goto("/content/schedule");
  await expect(page.getByRole("heading", { name: "콘텐츠 일정", exact: true })).toBeVisible();
  await expect(page.locator(".yp-dc")).toHaveCount(35);
  await page.getByRole("button", { name: "다음 기간", exact: true }).click();
  await expect(page.locator(".yp-schedule-nav")).toContainText("2026년 11월");
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(page.locator(".yp-schedule-nav")).toContainText("2026년 10월");
  await page.getByRole("button", { name: "이전 기간", exact: true }).click();
  await page.getByRole("button", { name: "이전 기간", exact: true }).click();
  await expect(page.locator(".yp-dc")).toHaveCount(42);
  await expect(page.locator('[data-date="2026-08-31"]')).toBeVisible();
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await page.getByRole("group", { name: "달력 보기" }).getByRole("button", { name: "주", exact: true }).click();
  await expect(page.locator(".yp-dc")).toHaveCount(7);
  await page.getByRole("group", { name: "달력 보기" }).getByRole("button", { name: "월", exact: true }).click();
  await page.getByLabel("담당 PD", { exact: true }).selectOption("demo-logan");
  await page.locator(".yp-schedule-status summary").click();
  await expect(page.locator(".yp-scard .yp-sc-p")).toHaveText(["담당 PD 로건", "담당 PD 로건", "담당 PD 로건"]);
  await page.getByLabel("단계", { exact: true }).selectOption("0");
  await expect(page.locator(".yp-scard .yp-sc-s")).toContainText(["주제"]);
  await page.getByLabel("담당 PD", { exact: true }).selectOption("all");
  await page.getByLabel("단계", { exact: true }).selectOption("all");
  await expect(page.locator(".yp-cal .yp-ev.yp-cf")).toHaveCount(1);
  await page.getByRole("button", { name: "컨펌 대기", exact: true }).click();
  await expect(page.locator(".yp-cal .yp-ev.yp-cf")).toHaveCount(0);
});

for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  test(`schedule layout at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto("/content/schedule");
    await expect(page.locator(".yp-undated-item").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width > 820) {
      const left = await page.locator(".yp-undated").boundingBox(), calendar = await page.locator(".yp-calw").boundingBox();
      expect(calendar!.x).toBeGreaterThan(left!.x + left!.width);
      expect(Math.abs(calendar!.y - left!.y)).toBeLessThan(1);
    } else {
      await expect(page.locator(".yp-calw")).toBeHidden();
      await page.locator(".yp-undated-item").first().click();
      await page.getByRole("button", { name: "날짜 직접 입력", exact: true }).click();
      await expect(page.getByRole("dialog", { name: /일정 바꾸기/ })).toBeVisible();
      await page.getByRole("button", { name: "취소", exact: true }).click();
    }
    await page.screenshot({ path: info.outputPath(`schedule-${width}-${theme}.png`), fullPage: true });
  });
}
