import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("brandy-os-menu-guide-final", "seen");
    localStorage.setItem("brandy-knowledge-focus", "false");
  });
});

test("knowledge tree has valid children and supports arrow and context-menu keys", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/knowledge");
  const tree = page.getByRole("tree", { name: "문서와 하위 페이지" });
  const items = tree.locator('[role="treeitem"][data-tree-index]');
  await expect(items.first()).toBeVisible();
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Element, options: object) => Promise<{ violations: { id: string }[] }> } }).axe;
    const result = await axe.run(document.querySelector(".knowledge-tree-scroll")!, { runOnly: ["aria-required-children"] });
    return result.violations.map(item => item.id);
  });
  expect(violations).toEqual([]);
  await tree.focus();
  await expect(items.first()).toBeFocused();
  await items.first().press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await items.nth(1).press("Home");
  await expect(items.first()).toBeFocused();
  await items.first().press("ArrowRight");
  await expect(items.first()).toHaveAttribute("aria-expanded", "true");
  await items.first().press("ArrowLeft");
  await expect(items.first()).toHaveAttribute("aria-expanded", "false");
  await items.first().press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem").first()).toBeFocused();
});

for (const [route, width] of [["/content/topics", 213], ["/content/scripts", 260]] as const) {
  test(`${route} keeps topbar actions reachable at ${width}px zoom-equivalent width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const selector of [".command-trigger", ".guidance-control", ".quick-add", ".development-notifications-trigger"]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x, selector).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(width);
    }
  });
}

test("mobile stage navigation explains horizontal scrolling and guide close has a usable target", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/content/topics");
  await expect(page.locator(".process-scroll-hint")).toBeVisible();
  await expect(page.locator(".stage-scroll-hint")).toBeVisible();
  for (const selector of [".process-steps", ".fullscreen-stage-tabs"]) {
    const scroller = page.locator(selector);
    expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth), selector).toBe(true);
    await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await scroller.evaluate(element => element.scrollLeft), selector).toBeGreaterThan(0);
  }
  const close = page.getByRole("button", { name: "이 화면 가이드 닫기" });
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(28);
  expect(box!.height).toBeGreaterThanOrEqual(28);
  await close.click();
  await expect(close).toHaveCount(0);
});
