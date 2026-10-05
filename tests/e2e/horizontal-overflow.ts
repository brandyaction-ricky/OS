import { expect, type Page } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page, route: string, tolerance = 0) {
  await expect.poll(async () => page.evaluate((allowed) => {
    const viewport = window.innerWidth;
    const actual = document.documentElement.scrollWidth;
    if (actual <= viewport + allowed) return "ok";
    const elements = [...document.querySelectorAll("*")]
      .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
      .filter(({ bounds }) => bounds.right > viewport + allowed || bounds.left < -allowed)
      .slice(0, 12)
      .map(({ element, bounds }) => ({
        tag: element.tagName.toLowerCase(),
        className: element.getAttribute("class"),
        left: Math.round(bounds.left),
        right: Math.round(bounds.right),
      }));
    return JSON.stringify({ viewport, actual, elements });
  }, tolerance), { message: `horizontal overflow on ${route}` }).toBe("ok");
}
