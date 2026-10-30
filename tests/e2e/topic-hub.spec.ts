import { expect, test } from "@playwright/test";

test.beforeEach(() => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "주제 찾기 requires the YouTube process v1 flag.");
});

// 주제 찾기 한 곳 (owner 2026-10-28): pick the platform first; each shows its own references and 반응도 기준 in the same place.
test("주제 찾기 switches platforms and starts a 숏폼 or a 광고 from a 초안 키워드", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/content/projects?view=discover");
  const tabs = page.getByRole("tablist", { name: "무엇을 만드나요" });
  await expect(tabs.getByRole("tab")).toHaveText([/롱폼/, /숏폼 · 릴스/, /광고/, /스레드/]);
  await expect(page.locator(".yp-pf-bar")).toContainText("채널 평소 조회수의 2배");
  await tabs.getByRole("tab", { name: /스레드/ }).click();
  await expect(page.locator(".yp-pf-bar")).toContainText("조회 10만 이상");
  await tabs.getByRole("tab", { name: /^광고/ }).click();
  await expect(page.locator(".yp-pf-bar")).toContainText("30일 넘게 켜진 영상 광고");
  await page.getByLabel("초안 키워드").fill("[시험] 강점 진단 광고");
  await page.getByRole("button", { name: /참고 자료 찾으러 가기/ }).click();
  await expect(page).toHaveURL(/\/content\/plan\?project=(?!new)[^&]+&view=topic/);
  const use = page.getByRole("radiogroup", { name: "숏폼 쓰임" });
  await expect(use.getByRole("radio", { name: /광고/ })).toHaveAttribute("aria-checked", "true");
  // 로건 QA 10/30: an ad's search words go to Aside for Meta's ad library, never to the YouTube Shorts search.
  await expect(page.getByLabel("메타 광고 검색어")).toHaveValue("[시험] 강점 진단 광고");
  await expect(page.getByRole("button", { name: "메타 광고 찾기 지시 복사" })).toHaveClass(/yp-pri/);
  await expect(page.getByRole("button", { name: "찾기", exact: true })).toHaveCount(0);
  await page.goto("/content/projects?view=discover&platform=short");
  await page.getByLabel("초안 키워드").fill("[시험] 일이 안 맞는 신호");
  await page.getByLabel("관련 링크").fill("https://www.tiktok.com/@demo/video/1");
  await page.getByRole("button", { name: /참고 자료 찾으러 가기/ }).click();
  await expect(page).toHaveURL(/view=topic/);
  await expect(page.getByRole("radiogroup", { name: "숏폼 쓰임" }).getByRole("radio", { name: /숏폼 · 릴스/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("틱톡 · https://www.tiktok.com/@demo/video/1")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/content/projects?view=discover&platform=ad");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "local-artifacts/topic-hub-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
