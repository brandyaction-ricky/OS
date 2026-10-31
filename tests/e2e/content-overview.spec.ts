import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

// 한눈에 보기 (리키 관제실 시안 v0.1 P1, owner decision 2026-10-31).
test("한눈에 보기 groups open work, confirms from the panel and switches to the board", async ({ page }) => {
  await page.goto("/content/overview");
  const pane = page.getByRole("complementary", { name: "확인 필요" });
  await expect(pane.getByRole("heading", { name: "확인 필요 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 일하는 중" })).toContainText("분째");
  await expect(page.getByRole("region", { name: "막힘" })).toContainText("참고 영상 주소를 열지 못했어요");
  await expect(page.getByRole("link", { name: /한눈에 보기/ }).first()).toBeVisible();
  // The state cards are 주제 찾기's platform cards; one narrows the list to its group.
  await page.getByRole("button", { name: /^사람 작업 중/ }).click();
  await expect(page.getByRole("region", { name: "AI 일하는 중" })).toHaveCount(0);
  await page.getByRole("button", { name: "전체 보기" }).click();

  await pane.getByRole("button", { name: "컨펌", exact: true }).click();
  await expect(pane.getByRole("heading", { name: "확인 필요 0" })).toBeVisible();
  await expect(pane).toContainText("주제 컨펌 → 컨펌");

  await page.getByRole("button", { name: "보드" }).click();
  await expect(page).toHaveURL(/view=board/);
  await page.getByRole("region", { name: "AI 일하는 중" }).getByRole("button").first().click();
  const detail = page.getByRole("complementary", { name: "고른 일" });
  await expect(detail).toContainText("AI가 가져감");
  await expect(detail.getByRole("link", { name: "화면 열기 →" })).toHaveAttribute("href", /\/content\/make\?project=/);
});

test("새 일 시작하기 opens the right first step for each platform", async ({ page }) => {
  await page.goto("/content/overview");
  await page.getByLabel("새로 만들 것").fill("월요일이 무거운 이유");
  await page.getByLabel("어디에").selectOption("short");
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page).toHaveURL(/view=discover&platform=short&q=/);
  await expect(page.getByLabel(/초안 키워드/)).toHaveValue("월요일이 무거운 이유");
});

test("the old step addresses open the v1 screens that replaced them", async ({ page }) => {
  await page.goto("/content/scripts");
  await expect(page).toHaveURL(/\/content\/projects$/);
  await page.goto("/content/topics");
  await expect(page).toHaveURL(/\/content\/projects\?view=discover/);
});
