import { expect, test } from "@playwright/test";
import { NAV_STAGES } from "../../lib/navigation";
import { youtubeV1Stages } from "../../lib/youtube-process/navigation";

const enabled = process.env.YOUTUBE_V1_ENABLED === "true";
const hrEnabled = process.env.HR_WORKSPACE_ENABLED === "true";
const teamEnabled = process.env.TEAM_V1_ENABLED === "true";
function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const values = color.startsWith("color(srgb") ? color.match(/[\d.]+/g)!.slice(0, 3).map(Number) : color.match(/[\d.]+/g)!.slice(0, 3).map(n => +n / 255);
    return values.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

test("four workspace headings preserve the existing authorized routes and nested menus", async ({ page }) => {
  await page.goto("/knowledge/vault");
  const sidebar = page.getByRole("complementary", { name: "주요 메뉴", exact: true });
  await expect(sidebar.locator(".os-nav-workspace-title")).toHaveText(["콘텐츠 제작", "지식 · 협업", "회사 운영", "시스템 관리"]);
  const stages = (enabled ? youtubeV1Stages(NAV_STAGES) : NAV_STAGES).filter(stage => !stage.requiresHr || hrEnabled);
  const expected = stages.flatMap(stage => stage.pages.filter(p => p.href !== "/hr/my-leave").map(p => teamEnabled && p.href === "/organization/members" ? "/organization/people" : p.href));
  const actual = await sidebar.locator(".page-link").evaluateAll(links => links.map(link => link.getAttribute("href")));
  for (const href of expected) expect(actual).toContain(href);
  const nested = stages.flatMap(stage => stage.pages.flatMap(p => p.children ?? []).map(p => p.href));
  const childLinks = await sidebar.locator(".page-sublink").evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(childLinks.sort()).toEqual(nested.sort());
  expect(await sidebar.locator(".nav-group-label").evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent))).toEqual([]);
  if (enabled) {
    for (const [platform, colour] of [["longform", "rgb(242, 138, 150)"], ["short", "rgb(200, 163, 239)"], ["ad", "rgb(139, 202, 216)"], ["card", "rgb(239, 186, 121)"]]) {
      await expect(sidebar.locator(`[data-stage="yt-${platform}"] .nav-icon`)).toHaveCSS("color", colour);
    }
  }
  await expect(sidebar.getByRole("button", { name: "회사 문서", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator('a.page-link[href="/knowledge/vault"]')).toHaveAttribute("aria-current", "page");
});

test("only one group opens, the active group closes, and finance links retain route and selection", async ({ page }) => {
  await page.goto("/knowledge/vault");
  const sidebar = page.locator("#main-navigation");
  const documents = sidebar.getByRole("button", { name: "회사 문서", exact: true });
  await documents.click();
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.locator("#nav-knowledge")).toBeHidden();
  await sidebar.getByRole("button", { name: "재무관리", exact: true }).click();
  await expect(sidebar.locator('.nav-group[aria-expanded="true"]')).toHaveCount(1);
  await sidebar.locator('#nav-finance a[href="/finance/overview"]').click();
  await expect(page).toHaveURL(/\/finance\/overview/);
  await expect(sidebar.locator('#nav-finance a[href="/finance/overview"]')).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(sidebar.getByRole("button", { name: "재무관리", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator('.nav-group[aria-expanded="true"]')).toHaveCount(1);
});

test("old all-open preferences do not crowd out the selected document or its folder filter", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("brandy-os-nav-groups", JSON.stringify({ content: true, knowledge: true, automation: true, finance: true, development: true, settings: true })));
  await page.goto("/knowledge/vault");
  await expect(page.locator('#main-navigation .nav-group[aria-expanded="true"]')).toHaveCount(1);
  await expect(page.locator('#main-navigation .nav-group[aria-expanded="true"]')).toHaveAttribute("aria-controls", "nav-knowledge");
  const tree = page.getByRole("textbox", { name: "폴더·문서 이름으로 거르기", exact: true });
  await expect(tree).toBeVisible();
  await tree.fill("Wiki");
  await expect(page.locator('a.page-link[href="/knowledge/vault"]')).toHaveAttribute("aria-current", "page");
});

test("mobile sidebar search uses the existing palette without competing focus traps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/knowledge/vault");
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("button", { name: "업무 메뉴 찾기", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "페이지·지식 검색", exact: true });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("textbox", { name: "검색할 페이지 또는 지식" })).toBeFocused();
  await expect(page.getByRole("button", { name: "메뉴 열기", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("button", { name: "메뉴 열기", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
  test(`grouped sidebar remains readable, collapsible and keyboard accessible at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem("brandy-os-theme", theme), theme);
    await page.goto("/knowledge/vault?document=demo-packaging");
    if (width < 821) await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    const sidebar = page.locator("#main-navigation");
    await expect(sidebar.getByRole("group", { name: "지식 · 협업", exact: true })).toBeVisible();
    const selected = sidebar.locator('a.page-link[href="/knowledge/vault"]');
    await expect(selected).toBeVisible();
    const colors = await sidebar.evaluate(element => {
      const style = getComputedStyle(element), selected = element.querySelector('.page-link.active')!;
      return [[style.color, style.backgroundColor], [getComputedStyle(element.querySelector('.os-nav-workspace-title')!).color, style.backgroundColor], [getComputedStyle(selected).color, getComputedStyle(selected).backgroundColor], [getComputedStyle(element.querySelector('.brand-mark')!).color, style.backgroundColor]];
    });
    for (const [fg, bg] of colors) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    // Match the approved study, not merely a high-contrast grayscale substitute.
    await expect(sidebar).toHaveCSS("background-color", theme === "light" ? "rgb(41, 37, 49)" : "rgb(21, 19, 25)");
    await expect(selected).toHaveCSS("background-color", theme === "light" ? "rgb(230, 238, 251)" : "rgb(41, 60, 86)");
    await expect(selected).toHaveCSS("color", theme === "light" ? "rgb(37, 77, 138)" : "rgb(196, 220, 255)");
    const categories = await sidebar.locator(".os-nav-workspace-title").evaluateAll(labels => labels.map(label => getComputedStyle(label, "::before").backgroundColor));
    expect(categories).toEqual(["rgb(194, 160, 237)", "rgb(161, 196, 250)", "rgb(146, 205, 181)", "rgb(188, 181, 199)"]);
    await expect(page.locator(".vault-workspace .knowledge-tree-pane")).toHaveCSS("background-color", theme === "light" ? "rgb(246, 248, 252)" : "rgb(28, 32, 41)");
    await expect(page.locator(".vault-workspace .editor-pane")).toHaveCSS("background-color", theme === "light" ? "rgb(247, 246, 249)" : "rgb(24, 22, 29)");

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".document-reader > h1")).toHaveText("패키징 원칙");
    const selectedDocument = page.locator('.vault-tree-row[aria-selected="true"]');
    await expect(selectedDocument).toHaveCSS("background-color", theme === "light" ? "rgb(230, 238, 251)" : "rgb(41, 60, 86)");
    await expect(selectedDocument).toHaveCSS("color", theme === "light" ? "rgb(37, 77, 138)" : "rgb(196, 220, 255)");
    const treeColors = await selectedDocument.evaluate(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    expect(contrast(treeColors[0], treeColors[1])).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: info.outputPath(`sidebar-${width}-${theme}.png`), mask: [page.locator(".profile-trigger")], maskColor: await sidebar.evaluate(el => getComputedStyle(el).backgroundColor) });
    if (width > 820) {
      await page.getByRole("button", { name: "내 계정 메뉴", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "내 계정", exact: true });
      await expect(menu).toBeVisible();
      const popup = await menu.evaluate(el => [getComputedStyle(el.querySelector("strong")!).color, getComputedStyle(el).backgroundColor]);
      expect(contrast(popup[0], popup[1])).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "사이드바 접기", exact: true }).click();
      await expect(sidebar).toHaveCSS("width", "64px");
      await expect(sidebar.locator('.compact-group[href="/knowledge/vault"]')).toBeVisible();
      await expect(sidebar.locator(".os-nav-workspace-title").first()).toBeHidden();
      await page.getByRole("button", { name: "사이드바 펼치기", exact: true }).click();
    } else {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "메뉴 열기", exact: true })).toBeFocused();
    }
  });
}
