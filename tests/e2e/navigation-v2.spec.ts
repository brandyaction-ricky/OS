import { expect, test } from "@playwright/test";
import { NAV_STAGES } from "../../lib/navigation";

for (const stage of NAV_STAGES.filter(stage => !stage.requiresHr)) {
  test(`existing pages keep the ${stage.label} navigation and title`, async ({ page }) => {
    for (const entry of stage.pages) {
      await page.goto(entry.href);
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(entry.href === "/home" ? /확인할 일 \d+건/ : entry.href === "/knowledge" ? "회사 문서" : entry.label);
      await expect(page.locator(".breadcrumbs [aria-current=page]")).toHaveText(entry.label);
      const title = entry.href.startsWith("/finance/") ? `${entry.label} · 재무관리` : entry.label;
      // Knowledge home has server metadata and a legacy shell title during hydration.
      await expect(page).toHaveTitle(entry.href === "/knowledge" ? /^(회사 문서|문서 홈) \| 브랜디 OS$/ : `${title} | 브랜디 OS`);
      await expect(page.locator(`.unified-nav a[href="${entry.href}"]`).last()).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".page-header .eyebrow, .dev-kicker")).toHaveCount(0);
    }
  });
}

test("groups, collapse and display preferences persist, and old names remain searchable", async ({ page }) => {
  await page.goto("/home");
  const content = page.getByRole("button", { name: "유튜브 공정", exact: true });
  await expect(content).toHaveAttribute("aria-expanded", "true");
  await page.reload(); await expect(content).toHaveAttribute("aria-expanded", "true");
  await content.click(); await page.reload(); await expect(content).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "사이드바 접기" }).click(); await page.reload();
  await expect(page.locator(".unified-sidebar")).toHaveCSS("width", "64px");
  await page.getByRole("button", { name: "사이드바 펼치기" }).click();
  await page.getByRole("button", { name: "내 계정 메뉴" }).click();
  await page.getByRole("button", { name: /모드로 전환/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: /사용 가이드/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-guidance", "off");
  await expect(page.getByRole("switch", { name: /사용 가이드/ })).toBeFocused();
  await page.getByRole("button", { name: "페이지·지식 검색" }).click();
  await page.getByRole("textbox", { name: "검색할 페이지 또는 지식" }).fill("개발 관리");
  await page.getByRole("dialog", { name: "페이지·지식 검색" }).getByRole("button", { name: "수정 요청 개발" }).click();
  await expect(page).toHaveURL(/\/knowledge\/development$/);
  await expect(page.locator(".breadcrumbs")).toContainText("개발");
});

test("quick record works when already in the document workspace", async ({ page }) => {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "기록 종류 선택", exact: true }).click();
  await page.getByRole("link", { name: "메모", exact: true }).click();
  const dialog=page.getByRole("dialog",{name:"새 문서",exact:true});
  await expect(dialog.getByRole("radio",{name:"내 노트 나만 봅니다. 메모·초안"})).toBeChecked();
  await dialog.getByRole("textbox",{name:"제목",exact:true}).fill("QA 빠른 기록 진입");
  await dialog.getByRole("button",{name:"만들기",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"문서 제목"})).toHaveValue("QA 빠른 기록 진입");
  await expect(page.getByRole("textbox",{name:"editable markdown"})).toBeVisible();
  await expect(page.locator(".kw-editor-card .kw-badge").first()).toContainText("내 노트");
});

for (const theme of ["dark", "light"]) for (const width of [1440, 390]) {
  test(`navigation at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto("/home");
    if (width === 390) await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.getByRole("button", { name: "유튜브 공정", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "주제·기획", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`uiux-navigation-${theme}-${width}.png`), fullPage: false, mask: [page.locator(".profile-trigger")], maskColor: await page.locator(".unified-sidebar").evaluate(element => getComputedStyle(element).backgroundColor) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) {
      await page.getByRole("link", { name: "영상 성과", exact: true }).click();
      // A sidebar link closes immediately; wait for the destination before
      // testing a new drawer lifecycle, not the router's in-flight focus move.
      await expect(page).toHaveURL(/\/content\/performance(?:\?|$)/);
      await expect(page.getByRole("heading", { name: "영상 성과", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "메뉴 열기" })).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("button", { name: "메뉴 열기" }).click();
      await expect(page.getByRole("button", { name: "메뉴 닫기", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "메뉴 열기" })).toBeFocused();
    }
  });
}

test("HR routes and navigation stay disabled before rollout", async ({ page, request }) => {
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "인사 노무 관리", exact: true })).toHaveCount(0);
  const response = await request.get("/api/v1/hr/session");
  expect(response.status()).toBe(404);
  expect((await response.json()).error.code).toBe("HR_DISABLED");
  await page.goto("/hr/employees");
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
});
