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
  await expect(page.getByText(/반응도 기준: 조회 5만 이상/)).toBeVisible();
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
  // GPT 초안 (2026-10-29): the 대본 step offers GPT first, the staff member's own AI second, both with the formula just picked.
  await expect(page.getByRole("button", { name: /GPT로 바로 쓰기/ })).toContainText("고른 공식으로 헤드 카피와 대본을 써요");
  await expect(page.getByRole("button", { name: /내 AI에게 맡기기/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a new 숏폼 starts from a 초안 키워드 and finds its references before the topic is fixed", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/content/plan?project=new&view=topic");
  await page.getByLabel("주제", { exact: true }).fill("[시험] 일이 안 맞는 신호");
  // Choosing 숏폼 saves the new video, so its 참고 영상 open at once.
  await page.getByLabel("숏폼 (릴스 · 광고)").check();
  await expect(page.getByLabel("참고 영상 검색어")).toBeVisible();
  await page.getByLabel("정밀 타겟").fill("일이 안 맞는 것 같은데 이유를 모르는 3~7년 차 직장인");
  await page.getByLabel("정밀 타겟").blur();
  await expect(page).toHaveURL(/project=(?!new)[^&]+/);
  const ai = page.getByRole("button", { name: /내 AI에게 맡기기/ });
  await expect(ai).toBeDisabled();
  await expect(ai).toContainText("먼저 4에서 참고 영상을 찾아요");
  const confirm = page.locator(".yp-foot").getByRole("button", { name: /주제 확정하고 다음으로/ });
  await expect(page.locator(".yp-foot")).toContainText("○ 참고 영상");
  await expect(confirm).toBeDisabled();
  // Typing the 검색어 and pressing [찾기] right away: the blur save and the button's save must not collide (2026-10-28 production).
  await page.getByLabel("참고 영상 검색어").fill("일이 안 맞는 신호");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.getByText("반응 높음").first()).toBeVisible();
  await expect(page.getByText(/먼저 고쳤어요/)).toHaveCount(0);
  await expect(ai).toBeEnabled();
  await expect(page.locator(".yp-foot")).toContainText("✓ 참고 영상");
  await expect(page.locator(".yp-foot")).toContainText("○ 공식");
  await expect(confirm).toBeDisabled();
  expect(errors).toEqual([]);
});
