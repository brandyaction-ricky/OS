import { expect, test } from "@playwright/test";

test.beforeEach(() => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "숏폼 주제 requires the YouTube process v1 flag.");
});

// 숏폼 주제 (owner direction 2026-10-28): 초안 주제 → 참고 영상 → 공식 · 주제 후보 → 주제 확정 → 대본 with the chosen formula.
test("a 숏폼 fixes its topic from a 주제 후보 drawn from the references' formulas", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/content/plan?project=demo-p12");
  const confirm = page.locator(".yp-foot").getByRole("button", { name: /주제 확정하고 다음으로/ });
  await expect(page.locator(".yp-foot")).toContainText("○ 공식");
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("[예시] 연봉 7천인데 그만두고 싶어요")).toBeVisible();
  // 반응도 기준: the bar is on screen, each reference shows its counts, and one under it is marked as not handed to the AI.
  await expect(page.getByText(/반응도 기준: 조회 10만 이상/)).toBeVisible();
  await expect(page.getByText("조회 125만 · 구독자의 13.6배 · 좋아요 3.3%")).toBeVisible();
  await expect(page.getByText("반응 높음")).toHaveCount(3);
  await expect(page.getByText("틱톡 · 직접 넣음")).toBeVisible();
  await expect(page.getByRole("button", { name: "릴스 · 틱톡 찾기 (Aside)" })).toBeVisible();
  await expect(page.getByText("기준 아래 · AI에 안 넘김")).toHaveCount(1);
  await page.getByRole("button", { name: "이 주제로" }).first().click();
  await expect(page.getByLabel("주제", { exact: true })).toHaveValue("[예시] 약속은 잡았는데 가기 싫을 때");
  await expect(page.getByText("고른 주제")).toBeVisible();
  await expect(page.getByLabel("참고 영상 검색어")).toHaveValue("[예시] 주말 약속 피곤함");
  await expect(confirm).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "local-artifacts/short-topic-research-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await confirm.click();
  // The demo keeps its data in the page: go on by the link, not a reload.
  await page.locator(".yp-foot").getByRole("link", { name: /이어서 하기 · 대본/ }).click();
  await expect(page.getByText("주제를 정할 때 고른 공식으로 헤드 카피와 대본을 써 줘요")).toBeVisible();
  expect(errors).toEqual([]);
});
