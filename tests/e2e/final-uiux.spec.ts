import { expect, test } from "@playwright/test";
import { NAV_STAGES, ACCOUNT_PAGE } from "../../lib/navigation";
import { RETIRED_ROUTES } from "../../lib/final-routes";
const pages = [...NAV_STAGES.flatMap(stage => stage.pages), ACCOUNT_PAGE];
const mobile = new Set(["/home", "/content/publishing", "/content/comments", "/content/performance", "/settings/account"]);
test("all 36 original routes select the final menu or explain their retirement", async ({ page }) => {
  test.setTimeout(90000);
  const retained = NAV_STAGES.flatMap(stage => stage.pages).filter(entry => entry.href !== "/content/comments" && !entry.href.includes("?"));
  const merged = [
    { href: "/home/decisions", label: "회의·결정", nav: "/organization/meetings" },
    { href: "/knowledge/graph", label: "전체 문서", nav: "/knowledge" },
    { href: "/organization/leave", label: "일정·휴가", nav: "/organization/schedule" },
    { href: "/settings/monitoring", label: "작동 상태", nav: "/settings/connections" },
    { href: "/settings/channels", label: "작동 상태", nav: "/settings/connections" },
  ];
  expect(retained.length + merged.length + Object.keys(RETIRED_ROUTES).length).toBe(36);
  for (const entry of [...retained.map(entry => ({ ...entry, nav: entry.href })), ...merged]) {
    await page.goto(entry.href);
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(entry.label);
    await expect(page.locator(`.page-link[href="${entry.nav}"]`)).toHaveAttribute("aria-current", "page");
  }
  for (const [href, label] of Object.entries(RETIRED_ROUTES)) {
    await page.goto(href);
    await expect(page).toHaveURL(url => url.pathname === "/home" && url.searchParams.get("moved") === label);
  }
});
for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
  test(`final screens ${width}px ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(theme => {
      localStorage.setItem("brandy-os-theme", theme);
      localStorage.setItem("brandy-os-menu-guide-final", "seen");
    }, theme);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const [index, entry] of pages.entries()) {
      if (width === 390 && !mobile.has(entry.href)) continue;
      await page.goto(entry.href);
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(entry.label);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".profile-trigger")).toBeAttached();
      if (entry.href.startsWith("/content/")) await expect(page.getByLabel("작업 중인 영상 선택")).toBeEnabled();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${String(index).padStart(2,"0")}-${theme}-${width}.png`), fullPage: true, mask: [page.locator(".profile-trigger")] });
    }
    expect(errors).toEqual([]);
  });
}
test("mock metrics preserve missing snapshots and show measured sample bounds", async ({ page }) => {
  await page.goto("/content/performance");
  const panel = page.getByRole("region", { name: "게시 후 경과일 비교" });
  await panel.getByRole("button", { name: "모의 성과 불러오기" }).click();
  await expect(panel.getByText("차이 없음 · 관찰 범위 겹침", { exact: false })).toBeVisible();
  await expect(panel.getByRole("row")).toHaveCount(13);
  await panel.getByLabel("경과일").selectOption("d1");
  await expect(panel.getByRole("row")).toHaveCount(1);
  await expect(panel.getByText("선택 범위의 측정값이 없습니다. 미측정은 0이 아닙니다.", { exact: true })).toBeVisible();
});
test("mock comment handling protects private channels and requires human confirmation", async ({ page }) => {
  await page.goto("/content/comments");
  await page.getByRole("button", { name: "모의 댓글 불러오기" }).click();
  const privateRow = page.locator(".comment-row").filter({ hasText: "비공유 · 보기 전용" });
  await privateRow.getByRole("button", { name: "답글 · 처리" }).click();
  const composer = page.locator(".comment-composer");
  await expect(composer.getByRole("button", { name: "모의 답글 보내기" })).toBeDisabled();
  await composer.getByRole("button", { name: "닫기", exact: true }).click();
  await page.locator(".comment-row").filter({ hasText: "내 채널" }).first().getByRole("button", { name: "답글 · 처리" }).click();
  await composer.getByLabel("답글 내용").fill("모의 검수 답변입니다.");
  await expect(composer.getByRole("button", { name: "모의 답글 보내기" })).toBeDisabled();
  await composer.getByRole("checkbox").check();
  await composer.getByRole("button", { name: "모의 답글 보내기" }).click();
  await expect(page.getByText("모의 처리 완료 · 외부 전송 없음", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "답함", exact: true }).click();
  await expect(page.locator(".comment-row")).toHaveCount(1);
});
