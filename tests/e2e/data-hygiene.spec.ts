import { expect, test } from "@playwright/test";
test("content selectors default to own and retain market/test filters", async ({ page }) => {
  for (const route of ["/content/performance", "/content/packages", "/content/shorts", "/content/youtube"]) {
    await page.goto(route);
    const filter = page.getByRole("combobox", { name: "콘텐츠 종류", exact: true });
    await expect(filter).toHaveValue("own");
    await filter.selectOption("test"); await expect(filter).toHaveValue("test");
    await filter.selectOption("market"); await expect(filter).toHaveValue("market");
  }
});
test("key issuance exposes three permission levels and a required expiry", async ({ page }) => {
  await page.goto("/settings/access"); await page.getByRole("button", { name: "키 발급", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "권한 범위", exact: true })).toHaveValue("draft");
  await expect(page.getByRole("combobox", { name: "권한 범위", exact: true }).locator("option")).toHaveCount(3);
  await expect(page.getByLabel("만료일", { exact: true })).toHaveAttribute("required", "");
  await expect(page.getByLabel("만료일", { exact: true })).not.toHaveValue("");
});
test("login cannot redirect outside and preserves internal document links", async ({ page }) => {
  for (const [destination,expected] of [["//outside.invalid", "/home"], ["/knowledge?document=fixture#heading", "/knowledge?document=fixture#heading"]]) {
    await page.goto(`/login?next=${encodeURIComponent(destination)}`);
    await page.getByLabel("이메일", { exact: true }).fill("fixture@example.test");
    await page.getByLabel("비밀번호", { exact: true }).fill("local-demo-only");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(url => `${url.pathname}${url.search}${url.hash}` === expected);
  }
});

for (const theme of ["dark", "light"]) for (const width of [1440, 390]) {
  test(`hygiene screens at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(value => localStorage.setItem("brandy-os-theme", value), theme);
    await page.goto("/content/performance");
    await expect(page.getByRole("combobox", { name: "콘텐츠 종류", exact: true })).toHaveValue("own");
    await page.screenshot({ path: `/private/tmp/uiux-hygiene-${theme}-${width}.png`, fullPage: true });
    await page.goto("/settings/access");
    await page.getByRole("button", { name: "키 발급", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "권한 범위", exact: true })).toHaveValue("draft");
    await page.screenshot({ path: `/private/tmp/uiux-key-${theme}-${width}.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
