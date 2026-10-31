import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.YOUTUBE_V1_ENABLED !== "true", "Requires the isolated YouTube-process demo.");
  await page.addInitScript(() => localStorage.setItem("brandy-os-menu-guide-final", "seen"));
});

test("스레드 정본 다듬기: the 시험 묶음, a 글타래 scored on the 정본 §7 관문 beside the draft, and the next draft without scrolling back", async ({ page }) => {
  await page.goto("/content/threads-canon");
  await expect(page.getByRole("heading", { name: "스레드 정본 다듬기" })).toBeVisible();
  await expect(page.getByText("지금 정본: 쓰레드 자동화 운영 정본 — 안저 · Aside × OS v5.9")).toBeVisible();
  await page.locator(".yp-grind-cell").first().click();
  const dialog = page.getByRole("dialog", { name: "평가표" });
  await expect(dialog.getByText(/^본문 · \d+자$/)).toBeVisible();
  for (const name of ["주제", "첫 줄과 본문", "관점의 답", "적용", "근거 · 의미", "읽기 · 형식"]) await expect(dialog.getByRole("radiogroup", { name, exact: true })).toBeVisible();
  for (const [index, grade] of ["상", "상", "상", "중", "상", "상"].entries()) await dialog.getByRole("radiogroup").nth(index).getByRole("radio", { name: grade }).click();
  await dialog.getByLabel("적용 이유").fill("예시 이유");
  await dialog.getByRole("button", { name: "저장하고 다음 글타래" }).click();
  await expect(dialog.getByText("2 / 2")).toBeVisible();
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByText(/채점 1\/2/)).toBeVisible();
  await expect(page.getByRole("link", { name: "정본 다듬기" }).last()).toHaveAttribute("href", "/content/threads-canon");
});
